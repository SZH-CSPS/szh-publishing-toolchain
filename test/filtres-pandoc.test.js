// Ce que les filtres Lua font vraiment, en faisant tourner pandoc.
//
//   node --test test/filtres-pandoc.test.js
//
// ⚠ CE FICHIER EST HORS DU GLOB `test/js/*.test.js`, ET C'EST VOULU. Le job `contrats` de
//   la CI n'installe pas la chaîne PDF — c'est sa raison d'être, il doit rendre son verdict
//   sans attendre. Ces contrôles-ci demandent pandoc : ils sont lancés par le job `pdf-ua`,
//   qui l'a déjà. Déplacer ce fichier sous test/js/ ferait échouer `contrats`.
//
// Aucun de ces contrôles ne s'abstient : si pandoc manque, ils ÉCHOUENT. Un test qui se
// neutralise tout seul ne protège rien.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..');
const FILTRES = path.join(RACINE, 'pipeline', 'filters');

function pandoc(entree, options) {
  const o = options || {};
  const args = ['--from=' + (o.de || 'html'), '--to=' + (o.vers || 'markdown'), '--wrap=none'];
  // --standalone : sans lui, le writer markdown de pandoc n'imprime pas le bloc de
  // métadonnées YAML — nécessaire pour lire resumes[].motscles en sortie.
  if (o.standalone) { args.push('--standalone'); }
  for (const f of (o.filtres || [])) { args.push('--lua-filter=' + path.join(FILTRES, f)); }
  const r = spawnSync('pandoc', args, { input: entree, encoding: 'utf8' });
  if (r.error) { throw new Error('pandoc introuvable : ' + r.error.message); }
  if (r.status !== 0) { throw new Error('pandoc a échoué : ' + r.stderr); }
  return r.stdout;
}

// ── Assainissement des attributs ───────────────────────────────────────────────────────
// Le lecteur docx pose le nom du style Word en classe : « Titre 2 (small) » devient
// `Titre-2-(small)`, que la syntaxe d'attributs de pandoc n'admet pas. Le bloc entier est
// alors abandonné à la relecture et s'imprime en toutes lettres.
//
// ⚠ On passe par le lecteur HTML, et non par un markdown écrit à la main : il range la
//   classe dans `el.classes`, exactement comme le lecteur docx. Un essai écrit en markdown
//   avec `class="…"` remplirait `el.attributes`, qui est une AUTRE table — et un filtre
//   fautif, lisant `attributes`, passerait l'essai sans rien corriger. C'est arrivé.
const TITRE_FAUTIF = '<h2 id="qui-a-fait-ce-livre" class="Titre-2-(small)">Qui ?</h2>';

test('attributs : le défaut existe bien sans le filtre', () => {
  assert.match(pandoc(TITRE_FAUTIF), /\(small\)/,
    'pandoc n’écrit plus la parenthèse : le défaut a changé de forme, revoir le filtre');
});

test('attributs : plus une parenthèse dans un bloc d’attributs, filtre appliqué', () => {
  const md = pandoc(TITRE_FAUTIF, { filtres: ['szh-attributs-sains.lua'] });
  const blocs = md.match(/\{[^}]*\}/g) || [];
  assert.ok(blocs.length, 'aucun bloc d’attributs : le contrôle ne prouverait rien');
  for (const bloc of blocs) {
    assert.ok(!/[()]/.test(bloc), 'une parenthèse subsiste dans ' + bloc);
  }
  assert.match(md, /\.Titre-2-small/, 'la classe n’a pas été normalisée : ' + md);
});

test('attributs : les lettres accentuées survivent', () => {
  const md = pandoc('<h2 id="ce-livre-a-été-mis-en-page-par" class="Titre-2-(small)">Été</h2>',
                    { filtres: ['szh-attributs-sains.lua'] });
  assert.match(md, /#ce-livre-a-été-mis-en-page-par/,
    'l’identifiant accentué a été abîmé alors que pandoc le relit sans peine : ' + md);
});

test('attributs : un lien interne suit l’identifiant renommé', () => {
  const md = pandoc('<p><a href="#section-(1)">voir</a></p><h2 id="section-(1)">Section</h2>',
                    { filtres: ['szh-attributs-sains.lua'] });
  assert.ok(!/#section-\(1\)/.test(md), 'le lien vise encore l’ancien identifiant : ' + md);
  assert.match(md, /#section-1/, 'le lien ne suit pas le renommage : ' + md);
});

// ── Sauts de ligne uniques ─────────────────────────────────────────────────────────────
// La maquette FALC lit en `markdown+hard_line_breaks` — en facile à lire, le retour à la
// ligne porte du sens. Mais l'import Word écrit AUSSI un `\` en fin de ligne : pandoc compte
// alors deux sauts, et le texte sort à double interligne. Sur un ouvrage réel, 282 des 570
// sauts étaient doubles et le livre faisait 64 pages contre 46 à l'édition d'origine.
const FALC = 'Première ligne.\\\nDeuxième ligne.\\\nTroisième ligne.\n';

test('sauts : sans le filtre, le `\\` et hard_line_breaks se cumulent', () => {
  const html = pandoc(FALC, { de: 'markdown+hard_line_breaks', vers: 'html' });
  assert.match(html, /<br\s*\/?>\s*<br\s*\/?>/,
    'le doublement ne se reproduit plus : pandoc a changé, revoir le filtre — ' + html);
});

test('sauts : avec le filtre, jamais deux sauts consécutifs', () => {
  const html = pandoc(FALC, { de: 'markdown+hard_line_breaks', vers: 'html',
                              filtres: ['szh-sauts-uniques.lua'] });
  assert.ok(!/<br\s*\/?>\s*<br\s*\/?>/.test(html), 'un saut double subsiste : ' + html);
  // Trois lignes, donc deux sauts : ni plus — ce serait le défaut — ni moins, ce qui
  // recollerait les phrases et détruirait la règle « une phrase, une ligne ».
  assert.equal((html.match(/<br\s*\/?>/g) || []).length, 2,
    'le compte de sauts n’est pas celui des lignes : ' + html);
});

// ── Tri des mots-clés par langue (A8) ──────────────────────────────────────────────────
// szh-maquette.lua trie chaque keywords.<langue> avant de le recopier dans
// resumes[].motscles (couverture + résumé) : table.sort nu compare des OCTETS, et en
// UTF-8 une lettre accentuée occupe deux octets plus grands que toute lettre ASCII —
// « École » finirait après « Zurich », « Ökonomie » après « Zürich ». cle_tri_motcle et
// motcle_avant réparent ça en repliant les diacritiques sur leur lettre de base avant de
// comparer, avec repli sur la chaîne brute à clé égale (sinon table.sort peut lever
// « invalid order function »).
//
// cle_tri_motcle, motcle_avant et PLIAGE_ACCENTS sont `local` au fichier, invisibles hors
// de lui : la seule prise est donc la sortie de Meta(), d'où un document complet
// (title+resume+keywords dans la langue) plutôt qu'un appel direct à la fonction — même
// niveau que les contrôles ci-dessus.
//
// ⚠ Défaut de BUILD constaté sur un pandoc Windows natif (winget JohnMacFarlane.Pandoc,
// 3.10) : string.lower() y fait passer les octets non-ASCII par la page de code active au
// lieu de les laisser intacts (comportement POSIX/Linux, celui de la CI ubuntu-24.04 et de
// WSL) — le premier octet UTF-8 d'une lettre accentuée change de valeur, et PLIAGE_ACCENTS
// ne reconnaît plus rien. Rien à voir avec szh-maquette.lua ni avec ce fichier : voir
// pliageCasse() ci-dessous, qui le détecte et saute les tests concernés en le disant plutôt
// que de les laisser rouges en permanence sur un tel poste.

// Construit une fiche minimale portant title/resume/keywords pour chaque langue donnée,
// juste assez pour que Meta() peuple resumes[].motscles sans buter sur un champ
// obligatoire vide (title) ni ignorer les mots-clés faute de résumé nom-vide.
function docMotscles(langues) {
  const noms = Object.keys(langues);
  let yaml = '---\nlang: ' + noms[0] + '\ntitle:\n';
  for (const l of noms) { yaml += '  ' + l + ': Titre\n'; }
  yaml += 'resume:\n';
  for (const l of noms) { yaml += '  ' + l + ': Resume.\n'; }
  yaml += 'keywords:\n';
  for (const l of noms) {
    const mots = langues[l];
    if (!mots.length) { yaml += '  ' + l + ': []\n'; continue; }
    yaml += '  ' + l + ':\n';
    for (const m of mots) { yaml += '    - ' + JSON.stringify(m) + '\n'; }
  }
  yaml += '---\n\nCorps.\n';
  return yaml;
}

// Relit resumes[].motscles pour une langue dans le markdown --standalone renvoyé par
// pandoc. Ancré sur « \n  lang: xx\n » (deux espaces) pour ne pas confondre avec le champ
// racine `lang:` (sans indentation) que Meta() pose aussi. Le groupe `motscles:` est
// optionnel : une liste vide n'est pas réécrite du tout par pandoc (le champ disparaît).
function motsclesPour(md, lang) {
  const re = new RegExp('\\n  lang: ' + lang + '\\n(?:  motscles:\\n((?:  - .*\\n)*))?  texte:');
  const m = md.match(re);
  assert.ok(m, 'bloc resumes[' + lang + '] introuvable dans la sortie : ' + md);
  const bloc = m[1] || '';
  return bloc.split('\n').filter((l) => l.length > 0).map((l) => l.slice(4));
}

function trierMotscles(langues) {
  const brut = pandoc(docMotscles(langues), { de: 'markdown', vers: 'markdown', standalone: true,
                                               filtres: ['szh-maquette.lua'] });
  // Un pandoc natif Windows imprime du CRLF (traduction de fin de ligne du runtime Haskell,
  // indépendante du filtre) ; motsclesPour ancre sur `\n` nu, donc on uniformise d'abord —
  // sans quoi ces tests-ci seraient les seuls du fichier à dépendre de la plateforme.
  const md = brut.replace(/\r\n/g, '\n');
  const res = {};
  for (const l of Object.keys(langues)) { res[l] = motsclesPour(md, l); }
  return res;
}

// Raison du défaut de pliage de CE pandoc, ou null s'il est sain — mémoïsé.
// undefined = pas encore vérifié ; null = sain (ou pandoc en échec, déjà dit par les six
// premiers tests du fichier, pas notre rôle ici de le redire) ; string = raison du défaut.
let pliageRaison;
function pliageCasse() {
  if (pliageRaison !== undefined) { return pliageRaison; }
  // 'É' (U+00C9) en UTF-8 = les octets \195\137, écrits en échappement pour ne rien devoir
  // à l'encodage de l'argument de ligne de commande lui-même. Sous une locale saine,
  // string.lower() ne touche pas ces octets (ASCII seul) : la chaîne reste égale à
  // elle-même.
  const r = spawnSync('pandoc', ['lua', '-e', "print(('\\195\\137'):lower() == '\\195\\137')"],
                       { encoding: 'utf8' });
  if (r.error || r.status !== 0 || r.stdout.trim() === 'true') {
    pliageRaison = null;
  } else {
    pliageRaison = 'string.lower() corrompt le premier octet UTF-8 d’une lettre accentuée ' +
      'sur ce build de pandoc (locale/page de code, pas le filtre — voir szh-maquette.lua, ' +
      'PLIAGE_ACCENTS) : (\'É\'):lower() ne se rend plus égal à lui-même.';
  }
  return pliageRaison;
}

// Saut bruyant, jamais silencieux : ce n'est pas le tri qui est déclaré correct, c'est le
// test qui est déclaré non fait — et pourquoi. SZH_LUA_OBLIGATOIRE=1 en fait un échec, pour
// qu'une CI (qui tourne sous ubuntu-24.04, jamais concernée par ce défaut) ne se contente
// jamais d'un saut.
function sauterSiPliageCasse(t) {
  const raison = pliageCasse();
  if (!raison) { return false; }
  const msg = 'pliage des accents cassé : ' + raison;
  if (process.env.SZH_LUA_OBLIGATOIRE) { assert.fail(msg); }
  console.warn('\n*** ' + msg + ' — tri des mots-clés NON vérifié ici ; il l’est par la CI ' +
    '(ubuntu-24.04, job pdf-ua) ***\n');
  t.skip(msg);
  return true;
}

test('mots-clés : ordre français, les accents rangés avec leur lettre', (t) => {
  if (sauterSiPliageCasse(t)) { return; }
  // « École » doit tomber entre « Dyslexie » et « Élève », pas après « Zurich » (tri par
  // octet nu).
  const res = trierMotscles({ fr: ['Zurich', 'École', 'Dyslexie', 'Élève'] });
  assert.deepEqual(res.fr, ['Dyslexie', 'École', 'Élève', 'Zurich'],
    'ordre français incorrect : ' + JSON.stringify(res.fr));
});

test('mots-clés : ordre allemand, ö/ü avec leur lettre et ß = ss', (t) => {
  if (sauterSiPliageCasse(t)) { return; }
  const res = trierMotscles({ de: ['Straße', 'Übung', 'Ökonomie', 'Anlage'] });
  assert.deepEqual(res.de, ['Anlage', 'Ökonomie', 'Straße', 'Übung'],
    'ordre allemand incorrect : ' + JSON.stringify(res.de));
});

test('mots-clés : œ, æ et majuscules accentuées se plient aussi', (t) => {
  if (sauterSiPliageCasse(t)) { return; }
  const res = trierMotscles({ fr: ['Œuvre', 'Æther', 'Zebre', 'Abricot'] });
  assert.deepEqual(res.fr, ['Abricot', 'Æther', 'Œuvre', 'Zebre'],
    'œ/æ mal repliés : ' + JSON.stringify(res.fr));
});

test('mots-clés : deux mots-clés identiques ne font pas planter le tri', () => {
  const res = trierMotscles({ fr: ['Alpes', 'Alpes'] });
  assert.deepEqual(res.fr, ['Alpes', 'Alpes'], 'doublon perdu ou réordonné : ' + JSON.stringify(res.fr));
});

test('mots-clés : deux mots pliant sur la même clé mais différents gardent un ordre total', () => {
  // « École » et « ecole » plient tous deux sur « ecole » : à clé égale, motcle_avant
  // retombe sur la chaîne brute, sans quoi table.sort peut lever « invalid order
  // function » selon l'ordre d'entrée.
  const res = trierMotscles({ fr: ['École', 'ecole'] });
  assert.deepEqual(res.fr, ['ecole', 'École'], 'repli à clé égale incorrect : ' + JSON.stringify(res.fr));
});

test('mots-clés : un mot-clé vide ne fait pas planter le tri', () => {
  const res = trierMotscles({ fr: ['', 'Alpes'] });
  assert.deepEqual(res.fr, ['', 'Alpes'], 'mot-clé vide mal placé ou perdu : ' + JSON.stringify(res.fr));
});

test('mots-clés : un seul mot-clé traverse sans erreur', () => {
  const res = trierMotscles({ fr: ['Solo'] });
  assert.deepEqual(res.fr, ['Solo'], 'mot-clé unique altéré : ' + JSON.stringify(res.fr));
});

test('mots-clés : une liste vide ne fait pas planter le tri', () => {
  assert.doesNotThrow(() => trierMotscles({ fr: [] }), 'pandoc a échoué sur une liste vide');
  const res = trierMotscles({ fr: [] });
  assert.deepEqual(res.fr, [], 'liste vide non vide en sortie : ' + JSON.stringify(res.fr));
});

test('mots-clés : le tri est indépendant par langue', (t) => {
  if (sauterSiPliageCasse(t)) { return; }
  // L'ordre du français n'a pas à correspondre à celui de l'allemand : chaque liste est
  // triée pour elle-même, sans fuite de l'une vers l'autre.
  const res = trierMotscles({
    fr: ['Zurich', 'École', 'Dyslexie'],
    de: ['Wien', 'Österreich', 'Anlage'],
  });
  assert.deepEqual(res.fr, ['Dyslexie', 'École', 'Zurich'],
    'liste française altérée : ' + JSON.stringify(res.fr));
  assert.deepEqual(res.de, ['Anlage', 'Österreich', 'Wien'],
    'liste allemande altérée : ' + JSON.stringify(res.de));
});
