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
const fs = require('fs');
const os = require('os');

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

// ── Détection de langue : le comportement ACTUEL de quatre filtres ─────────────────────
// szh-maquette.lua, szh-numerotation.lua, szh-ressource.lua et szh-citations.lua lisent
// chacun la langue de composition à leur manière — quatre fonctions indépendantes,
// jamais un module commun (chacune le redit dans son propre commentaire de tête). Ce qui
// suit ne corrige rien : ça fixe ce qu'elles font aujourd'hui, sur les quatre cas qui les
// distinguent, pour qu'un futur chantier de convergence parte d'un état mesuré plutôt que
// supposé. Chaque test vérifie D'ABORD que sa sortie dépend réellement du filtre — le
// patron déjà suivi plus haut dans ce fichier.
//
// Seul szh-maquette.lua et szh-numerotation.lua et szh-citations.lua relisent
// <slug>.meta.yaml sur le disque (io.open, pas les métadonnées fusionnées de pandoc) :
// le prouver demande un VRAI fichier, au bon nom, dans le dossier courant de pandoc —
// une invocation par stdin, sans nom de fichier, ne peut pas nourrir cette lecture.
// szh-ressource.lua, lui, ne lit que les métadonnées déjà fusionnées (meta.lang,
// meta.revue) : sans --metadata-file pour la fiche, il ne la voit jamais, quand bien
// même elle existerait à côté du .md — le cas « fiche seule » ci-dessous le montre.

function dossierJetable(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
}

// Écrit les fichiers donnés (nom -> contenu) dans un dossier jetable, lance pandoc DEPUIS
// ce dossier sur `principal`, avec le filtre donné. `essai.meta.yaml`, s'il est fourni,
// n'est jamais passé en --metadata-file : seule une lecture directe par le filtre
// (io.open) le verra, exactement comme dans la chaîne réelle où le Makefile ne le passe
// pas non plus à cette place (voir szh-numerotation.lua, langue_fiche()).
// `opts.from` : le lecteur, « markdown » par défaut (celui du PDF) — passer « commonmark_x »
// pour rejouer la passe d'aperçu. `opts.env` : variables ajoutées à celles du processus, par
// exemple SZH_APERCU ou SZH_LIVRE, exactement ce que le Makefile pose autour de pandoc.
function pandocDansDossier(fichiers, principal, filtre, opts) {
  const o = opts || {};
  const dossier = dossierJetable('szh-langue-');
  try {
    for (const nom of Object.keys(fichiers)) {
      fs.writeFileSync(path.join(dossier, nom), fichiers[nom], 'utf8');
    }
    const args = ['--from=' + (o.from || 'markdown'), '--to=markdown', '--wrap=none', '--standalone',
      '--lua-filter=' + path.join(FILTRES, filtre), principal];
    const env = Object.assign({}, process.env, o.env || {});
    const r = spawnSync('pandoc', args, { cwd: dossier, encoding: 'utf8', env: env });
    if (r.error) { throw new Error('pandoc introuvable : ' + r.error.message); }
    // Un pandoc natif Windows imprime du CRLF (traduction de fin de ligne du runtime
    // Haskell, indépendante des filtres) : uniformisé ici, comme trierMotscles() plus
    // haut dans ce fichier, pour que les motifs ancrés sur `\n` nu restent valables
    // quelle que soit la plateforme qui fait tourner ce test.
    const stdout = (r.stdout || '').replace(/\r\n/g, '\n');
    return { stdout, stderr: r.stderr, status: r.status };
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

// ── szh-maquette.lua : lit <slug>.meta.yaml en premier, meta.lang puis le jeton de revue,
// « fr » en dernier repli. Sortie observée : le `lang:` qu'il pose lui-même sur le document
// (meta['lang'], §Meta() en toute fin) — visible tel quel dans le bloc YAML du writer
// markdown --standalone.
function docMaquette(entete) {
  return '---\n' + entete + 'title:\n  fr: "Titre"\n  de: "Titel"\n---\n\nCorps.\n';
}

test('langue (préparation) : szh-maquette.lua sans filtre ne pose aucun lang: propre', () => {
  const r = pandocDansDossier({ 'essai.md': docMaquette('') }, 'essai.md', 'szh-attributs-sains.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/\nlang: /.test(r.stdout), 'un lang: existe déjà sans szh-maquette.lua : ' + r.stdout);
});

test('langue : szh-maquette.lua — fiche avec lang: de l’emporte sur revue: revue', () => {
  const r = pandocDansDossier(
    { 'essai.md': docMaquette('revue: revue\n'), 'essai.meta.yaml': 'lang: de\n' },
    'essai.md', 'szh-maquette.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\nlang: de\n/, 'la fiche ne l’emporte plus sur le jeton de revue : ' + r.stdout);
});

test('langue : szh-maquette.lua — meta.lang seul', () => {
  const r = pandocDansDossier({ 'essai.md': docMaquette('lang: de\n') }, 'essai.md', 'szh-maquette.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\nlang: de\n/, r.stdout);
});

test('langue : szh-maquette.lua — jeton de revue: zeitschrift seul', () => {
  const r = pandocDansDossier({ 'essai.md': docMaquette('revue: zeitschrift\n') }, 'essai.md', 'szh-maquette.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\nlang: de\n/, r.stdout);
});

test('langue : szh-maquette.lua — rien du tout, repli français', () => {
  const r = pandocDansDossier({ 'essai.md': docMaquette('') }, 'essai.md', 'szh-maquette.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\nlang: fr\n/, r.stdout);
});

// ── szh-numerotation.lua : sa propre langue_fiche()/langue_de(), même ordre de priorité.
// Sortie observée : le libellé qu'il pose devant une légende de figure — « Figure » ou
// « Abbildung ».
function docNumerotation(entete) {
  return '---\n' + entete + '---\n\n![Légende de test](x.png)\n';
}

test('langue (préparation) : sans szh-numerotation.lua, pas de préfixe de légende', () => {
  const r = pandocDansDossier({ 'essai.md': docNumerotation('') }, 'essai.md', 'szh-attributs-sains.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/Figure 1|Abbildung 1/.test(r.stdout), 'un préfixe existe déjà sans le filtre : ' + r.stdout);
});

test('langue : szh-numerotation.lua — fiche avec lang: de l’emporte sur revue: revue', () => {
  const r = pandocDansDossier(
    { 'essai.md': docNumerotation('revue: revue\n'), 'essai.meta.yaml': 'lang: de\n' },
    'essai.md', 'szh-numerotation.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Abbildung 1/, 'la fiche ne l’emporte plus sur le jeton de revue : ' + r.stdout);
});

test('langue : szh-numerotation.lua — meta.lang seul', () => {
  const r = pandocDansDossier({ 'essai.md': docNumerotation('lang: de\n') }, 'essai.md', 'szh-numerotation.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Abbildung 1/, r.stdout);
});

test('langue : szh-numerotation.lua — jeton de revue: zeitschrift seul', () => {
  const r = pandocDansDossier({ 'essai.md': docNumerotation('revue: zeitschrift\n') }, 'essai.md', 'szh-numerotation.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Abbildung 1/, r.stdout);
});

test('langue : szh-numerotation.lua — rien du tout, repli français', () => {
  const r = pandocDansDossier({ 'essai.md': docNumerotation('') }, 'essai.md', 'szh-numerotation.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Figure 1/, r.stdout);
});

// ── szh-numerotation.lua : le constat « figure-sans-alt », UNIQUEMENT sous SZH_APERCU ──
//
// Émis sur l'AST intact de la passe d'aperçu (commonmark_x) : c'est le seul moment où
// alt="" (décoratif, voulu) se distingue encore d'un alt absent. La passe PDF (markdown)
// ne doit jamais rien dire — SZH_APERCU n'y est pas posée, comme dans la vraie chaîne.

test('figure-sans-alt : ni alt ni légende — un constat, sous SZH_APERCU', () => {
  const r = pandocDansDossier({ 'essai.md': '![](x.png)\n' }, 'essai.md', 'szh-numerotation.lua',
    { from: 'commonmark_x', env: { SZH_APERCU: '1' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /^\[numerotation-avertissement\] figure-sans-alt \|/m,
    'aucun constat codé : ' + r.stderr);
  assert.match(r.stderr, /article « essai »/);
  assert.match(r.stderr, /image « x\.png »/);
  assert.match(r.stderr, /\[de\] Das Bild x\.png/);
});

test('figure-sans-alt : alt="" explicite (décoratif voulu) — aucun constat', () => {
  const r = pandocDansDossier({ 'essai.md': '![](x.png){alt=""}\n' }, 'essai.md', 'szh-numerotation.lua',
    { from: 'commonmark_x', env: { SZH_APERCU: '1' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/figure-sans-alt/.test(r.stderr), 'une image alt="" explicite est signalée : ' + r.stderr);
});

test('figure-sans-alt : alt absent mais légende présente — aucun constat', () => {
  const r = pandocDansDossier({ 'essai.md': '![Légende](x.png)\n' }, 'essai.md', 'szh-numerotation.lua',
    { from: 'commonmark_x', env: { SZH_APERCU: '1' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/figure-sans-alt/.test(r.stderr), 'une image avec légende est signalée : ' + r.stderr);
});

test('figure-sans-alt : sans SZH_APERCU (passe PDF), jamais de constat', () => {
  const r = pandocDansDossier({ 'essai.md': '![](x.png)\n' }, 'essai.md', 'szh-numerotation.lua',
    { from: 'markdown' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/figure-sans-alt/.test(r.stderr), 'la passe PDF signale une image : ' + r.stderr);
});

// ── szh-ressource.lua : SA propre langue_de(), plus simple — meta.lang direct (fr/de
// seulement, pas de lecture de fiche), puis le jeton de revue, « fr » en dernier repli.
// Sortie observée : le texte du lien généré, qui nomme la ressource dans la langue
// détectée — « En savoir plus sur le livre… » / « Mehr zum Buch… ».
function docRessource(entete) {
  return '---\n' + entete + '---\n\n'
    + '::: {#r1 .szh-ressource type="livre" titre="Mon Titre" lien="https://exemple.org"}\n'
    + 'Descriptif.\n:::\n';
}

test('langue (préparation) : sans szh-ressource.lua, pas de texte de lien généré', () => {
  const r = pandocDansDossier({ 'essai.md': docRessource('') }, 'essai.md', 'szh-attributs-sains.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/savoir plus|Mehr zum/.test(r.stdout), 'un texte de lien existe déjà sans le filtre : ' + r.stdout);
});

test('langue : szh-ressource.lua — une fiche sur le disque, JAMAIS lue (pas de meta.lang fusionné)', () => {
  // Contrairement aux trois autres, ce filtre ne relit aucun fichier : seules les
  // métadonnées que pandoc a déjà fusionnées comptent. Une fiche présente mais non
  // passée en --metadata-file (comme ici) n'a donc AUCUN effet — le résultat retombe
  // sur le même repli français que « rien du tout ».
  const r = pandocDansDossier(
    { 'essai.md': docRessource('revue: revue\n'), 'essai.meta.yaml': 'lang: de\n' },
    'essai.md', 'szh-ressource.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /En savoir plus sur le livre Mon Titre/,
    'la fiche sur le disque a été lue alors que szh-ressource.lua ne le fait jamais : ' + r.stdout);
});

test('langue : szh-ressource.lua — meta.lang seul', () => {
  const r = pandocDansDossier({ 'essai.md': docRessource('lang: de\n') }, 'essai.md', 'szh-ressource.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Mehr zum Buch Mon Titre/, r.stdout);
});

test('langue : szh-ressource.lua — jeton de revue: zeitschrift seul', () => {
  const r = pandocDansDossier({ 'essai.md': docRessource('revue: zeitschrift\n') }, 'essai.md', 'szh-ressource.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Mehr zum Buch Mon Titre/, r.stdout);
});

test('langue : szh-ressource.lua — rien du tout, repli français', () => {
  const r = pandocDansDossier({ 'essai.md': docRessource('') }, 'essai.md', 'szh-ressource.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /En savoir plus sur le livre Mon Titre/, r.stdout);
});

// ── szh-citations.lua : langue_article(), même ordre que szh-maquette.lua (sa propre
// duplication assumée, voir son commentaire de tête). Sortie observée : le titre de
// bibliographie posé au-dessus de la liste résolue — « Références » ou « Literatur »
// (TITRES_BIBLIO_DEFAUT ne distingue pas « revue » de « zeitschrift », seule la langue
// compte pour ce titre-là).
function docCitations(entete) {
  return '---\n' + entete + '---\n\n'
    + 'Un texte, sans appel à lier ici.\n\n'
    + '::: {.szh-biblio src="essai.biblio.md"}\n:::\n';
}
const BIBLIO_ESSAI = 'Dupont, J. (2020). Un titre. Éditions.\n';

test('langue (préparation) : sans szh-citations.lua, la référence à la bibliographie n’est pas résolue', () => {
  const r = pandocDansDossier(
    { 'essai.md': docCitations(''), 'essai.biblio.md': BIBLIO_ESSAI },
    'essai.md', 'szh-attributs-sains.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/Références|Literatur/.test(r.stdout), 'un titre de bibliographie existe déjà sans le filtre : ' + r.stdout);
});

test('langue : szh-citations.lua — fiche avec lang: de l’emporte sur revue: revue', () => {
  const r = pandocDansDossier(
    { 'essai.md': docCitations('revue: revue\n'), 'essai.meta.yaml': 'lang: de\n',
      'essai.biblio.md': BIBLIO_ESSAI },
    'essai.md', 'szh-citations.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Literatur/, 'la fiche ne l’emporte plus sur le jeton de revue : ' + r.stdout);
});

test('langue : szh-citations.lua — meta.lang seul', () => {
  const r = pandocDansDossier(
    { 'essai.md': docCitations('lang: de\n'), 'essai.biblio.md': BIBLIO_ESSAI },
    'essai.md', 'szh-citations.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Literatur/, r.stdout);
});

test('langue : szh-citations.lua — jeton de revue: zeitschrift seul', () => {
  const r = pandocDansDossier(
    { 'essai.md': docCitations('revue: zeitschrift\n'), 'essai.biblio.md': BIBLIO_ESSAI },
    'essai.md', 'szh-citations.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Literatur/, r.stdout);
});

test('langue : szh-citations.lua — rien du tout, repli français', () => {
  const r = pandocDansDossier(
    { 'essai.md': docCitations(''), 'essai.biblio.md': BIBLIO_ESSAI },
    'essai.md', 'szh-citations.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Références/, r.stdout);
});


// ── szh-cesure.lua : les noms propres soustraits à la césure, en français seulement ───
// Le corps est justifié avec `hyphens: auto` (print.css §4) et WeasyPrint coupait donc
// « Fri-bourg ». Le filtre relève les noms propres sur la POSITION de leur majuscule, puis
// les enveloppe dans un span de classe szh-sans-cesure — voir son commentaire de tête pour
// les deux règles du relevé et le défaut qui reste. Ce qui est fixé ici, ce sont ces règles
// et l'exception PDF/UA sur les liens.
//
// Lecture markdown -> HTML : c'est la sortie où le span se lit tel quel. Le `lang:` du bloc
// YAML suffit à porter la langue de composition (meta.lang), le filtre ne relisant pas la
// fiche sur le disque.

function docFr(corps, langue) {
  return '---\nlang: ' + (langue || 'fr') + '\n---\n\n' + corps + '\n';
}

function cesure(corps, langue) {
  return pandoc(docFr(corps, langue),
    { de: 'markdown', vers: 'html', filtres: ['szh-cesure.lua'] });
}

// Combien de fois `mot` est enveloppé. Le writer HTML de pandoc replie ses lignes : la
// balise ouvrante peut donc être coupée entre `<span` et `class=`, d'où la classe de
// caractères plutôt qu'un point.
function enveloppes(html, mot) {
  const re = new RegExp('<span[\\s\\S]*?class="szh-sans-cesure">' + mot + '</span>', 'g');
  return (html.match(re) || []).length;
}

test('césure (préparation) : sans le filtre, aucun span n’est posé', () => {
  const html = pandoc(docFr('Le module de Fribourg accueille du monde.'),
    { de: 'markdown', vers: 'html' });
  assert.ok(!/szh-sans-cesure/.test(html), 'un span existe déjà sans le filtre : ' + html);
});

test('césure : une majuscule au milieu d’une phrase est un nom propre', () => {
  const html = cesure('Le module de Fribourg accueille du monde.');
  assert.strictEqual(enveloppes(html, 'Fribourg'), 1, html);
});

test('césure : moins de 5 lettres, jamais enveloppé — WeasyPrint ne les coupe pas', () => {
  const html = cesure('Le module de Sion accueille du monde.');
  assert.ok(!/szh-sans-cesure/.test(html), 'un mot de 4 lettres a été enveloppé : ' + html);
});

test('césure : un mot qui n’apparaît qu’en tête de phrase, suivi d’une minuscule, est laissé', () => {
  const html = cesure('Fribourg est une ville de Suisse romande.');
  assert.strictEqual(enveloppes(html, 'Fribourg'), 0,
    'un mot de tête de phrase a été pris pour un nom propre : ' + html);
});

test('césure : deux capitales de suite en tête de phrase — un nom de personne', () => {
  const html = cesure('Christian Singele parle de son travail.');
  assert.strictEqual(enveloppes(html, 'Christian'), 1, html);
  assert.strictEqual(enveloppes(html, 'Singele'), 1, html);
});

test('césure : un nom relevé une fois est protégé partout, tête de phrase comprise', () => {
  const html = cesure('Le canton de Fribourg est grand. Fribourg accueille du monde.');
  assert.strictEqual(enveloppes(html, 'Fribourg'), 2,
    'la seconde occurrence, en tête de phrase, n’est pas protégée : ' + html);
});

test('césure : le trait d’union fait corps avec le nom', () => {
  const html = cesure('Le texte de Cudré-Mauroux et de La Chaux-de-Fonds.');
  assert.strictEqual(enveloppes(html, 'Cudré-Mauroux'), 1, html);
  assert.strictEqual(enveloppes(html, 'Chaux-de-Fonds'), 1, html);
});

test('césure : en allemand, RIEN — tous les substantifs y portent la majuscule', () => {
  const html = cesure('Das Modul von Freiburg nimmt Studierende auf.', 'de');
  assert.ok(!/szh-sans-cesure/.test(html), 'le filtre a agi sur un article allemand : ' + html);
});

// ⚠ PDF/UA-1 7.18.5 : un lien ne doit contenir aucun élément, sinon WeasyPrint pose une
// annotation par boîte descendante et une seule est rattachée au /Link de l'arbre de
// structure. Mesuré le 08.09.2026 : les spans posés dans les liens de l'article d'essai
// faisaient tomber la porte veraPDF (« Lien mal balisé, 11 fois, page 2 »). Le lien porte
// donc la classe lui-même, et ce contrôle est la seule chose qui garde cette décision.
test('césure : dans un lien, la classe va sur le <a> et JAMAIS un span dedans', () => {
  const html = cesure('Voir la [Haute école de Fribourg](https://example.ch) pour cela.');
  assert.match(html, /<a href="https:\/\/example\.ch" class="szh-sans-cesure">/,
    'le lien ne porte pas la classe : ' + html);
  assert.ok(!/<a[\s\S]*?szh-sans-cesure[\s\S]*?<span/.test(html),
    'un span a été laissé à l’intérieur du lien (PDF/UA-1 7.18.5) : ' + html);
});

// ── szh-maquette.lua : les initiales de prénom de la couverture ────────────────────────
// Sur la couverture, le prénom est réduit à ses initiales — « de Diesbach, J. » (décision
// du 08.09.2026). Le bloc « À propos des auteur·e·s », lui, garde le prénom entier : c'est
// là qu'on présente les personnes, la couverture ne fait que les créditer.
//
// Sortie observée : la clé `initiales` que le filtre pose sur chaque auteur, visible telle
// quelle dans le bloc YAML du writer markdown --standalone. Lire la source ne dirait rien
// du découpage réel d'un prénom accentué ou composé, qui est tout l'enjeu.

function initiales(auteurs) {
  const md = ['---', 'revue: revue', 'lang: fr', 'title:', '  fr: "Titre"', 'author:']
    .concat(auteurs).concat(['---', '', 'Corps.', '']).join('\n');
  const r = pandocDansDossier({ 'essai.md': md }, 'essai.md', 'szh-maquette.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  // Le writer YAML de pandoc range les cles par ordre alphabetique : `initiales` ouvre
  // donc l'element de liste et prend le tiret, sauf si l'auteur porte une cle qui la
  // precede (affiliation). Les deux formes sont acceptees.
  return (r.stdout.match(/^[- ]\s*initiales: (.*)$/gm) || [])
    .map((l) => l.replace(/^[- ]\s*initiales: /, '').replace(/^'|'$/g, ''));
}

test('initiales (préparation) : sans le filtre, la clé n’existe pas', () => {
  const r = pandocDansDossier(
    { 'essai.md': ['---', 'author:', '- prenom: "Jérôme"', '  nom: "de Diesbach"',
      '---', '', 'Corps.', ''].join('\n') },
    'essai.md', 'szh-attributs-sains.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/initiales:/.test(r.stdout), 'une clé initiales existe déjà sans le filtre : ' + r.stdout);
});

test('initiales : un prénom simple donne une lettre et un point', () => {
  assert.deepStrictEqual(
    initiales(['- prenom: "Jérôme"', '  nom: "de Diesbach"']), ['J.']);
});

// ⚠ Trait d'union INSÉCABLE (U+2011) et non ordinaire : « J.-B. » est une abréviation, pas
// un mot composé, et la coupure à un trait d'union ordinaire relève de UAX #14 — aucun
// réglage `hyphens` ne l'empêche. Mesuré : la couverture à dix auteur·e·s sortait
// « Rossier, J.- » en fin de ligne et « B. » au début de la suivante.
test('initiales : un prénom à trait d’union garde un trait d’union, mais INSÉCABLE', () => {
  const TIRET = '\u2011';
  assert.deepStrictEqual(
    initiales(['- prenom: "Jean-Baptiste"', '  nom: "Rossier"']), ['J.' + TIRET + 'B.']);
  assert.deepStrictEqual(
    initiales(['- prenom: "Marie-Christine"', '  nom: "Vannotti"']), ['M.' + TIRET + 'C.']);
});

// ⚠ Une espace ORDINAIRE ouvrirait une coupure de ligne au milieu d'un nom, sur une
// couverture où la liste passe déjà à deux ou trois lignes.
test('initiales : deux prénoms séparés d’une espace prennent une INSÉCABLE', () => {
  assert.deepStrictEqual(
    initiales(['- prenom: "Marie Christine"', '  nom: "Vannotti"']), ['M.\u00A0C.']);
});

// ⚠ Le cas qui casse un découpage en octets : « É » s'encode sur deux octets, et un
// prenom:sub(1, 1) rendrait la moitié d'un caractère.
test('initiales : une capitale accentuée sort entière', () => {
  assert.deepStrictEqual(initiales(['- prenom: "\u00c9lodie"', '  nom: "Winkler"']), ['\u00c9.']);
});

test('initiales : pas de prénom, pas de clé — la couverture n’imprime que le nom', () => {
  assert.deepStrictEqual(initiales(['- nom: "SZH/CSPS"']), []);
});
