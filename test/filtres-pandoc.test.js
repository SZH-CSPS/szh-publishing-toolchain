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

// ── szh-maquette.lua : entete-condensee, défaut « compact » depuis le 09.09.2026 ───────
// Verrou des trois cas de la clé (absente / true / false), plus le cas que le garde-fou
// est_vrai existe pour attraper : une chaîne CITÉE « false » — le sérialiseur du cockpit
// cite ses valeurs, et pour pandoc toute chaîne non vide est vraie. Sortie observée : la
// ligne `entete-condensee: true` du bloc YAML du writer markdown --standalone quand la clé
// doit ressortir vraie, son absence complète sinon — pandoc n'imprime jamais une valeur
// MetaBool fausse, il retire la clé (voir le relevé manuel qui a servi à écrire ce motif).
test('entete-condensee : clé absente -> vraie, le nouveau défaut', () => {
  const r = pandocDansDossier({ 'essai.md': docMaquette('') }, 'essai.md', 'szh-maquette.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\nentete-condensee: true\n/,
    'clé absente d’ausgabe.yaml : elle doit ressortir vraie (compact) — ' + r.stdout);
});

test('entete-condensee : true -> reste vraie', () => {
  const r = pandocDansDossier(
    { 'essai.md': docMaquette('entete-condensee: true\n') }, 'essai.md', 'szh-maquette.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\nentete-condensee: true\n/, r.stdout);
});

test('entete-condensee : false -> reste fausse, hauteur fixe', () => {
  const r = pandocDansDossier(
    { 'essai.md': docMaquette('entete-condensee: false\n') }, 'essai.md', 'szh-maquette.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/\nentete-condensee: /.test(r.stdout),
    'une valeur explicite fausse ne doit pas ressortir vraie — ' + r.stdout);
});

test('entete-condensee : "false" citée (comme l’écrit le cockpit) -> reste fausse', () => {
  const r = pandocDansDossier(
    { 'essai.md': docMaquette('entete-condensee: "false"\n') }, 'essai.md', 'szh-maquette.lua');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/\nentete-condensee: /.test(r.stdout),
    'une chaîne "false" citée compte comme vraie pour pandoc si on ne passe pas par ' +
    'est_vrai — c’est exactement le cas que ce garde-fou existe pour attraper — ' + r.stdout);
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

// ── L'aperçu sous commonmark_x+sourcepos : ce que szh-sourcepos.lua répare ─────────────
//
// L'aperçu HTML du cockpit ne peut lire les .md qu'avec `--from=commonmark_x+sourcepos` :
// c'est le seul lecteur qui pose les positions source dont la webview a besoin pour le clic
// vers le texte — un dernier test, plus bas, documente pourquoi `markdown+sourcepos`
// n'existe pas. Mais ce lecteur déforme l'arbre : chaque en-ligne est enveloppé dans un Span
// « wrapper=1 », et les mots sont découpés à chaque signe (« p. » devient Str "p" + Str ".").
// Mesuré le 11.09.2026 sur un article d'essai : szh-typographie.lua posait 0 insécable au
// lieu de 6, szh-citations.lua ne liait plus un seul appel à sa référence. szh-sourcepos.lua,
// posé en tête de la chaîne d'aperçu, défait les deux, et ce qui suit le prouve filtre par
// filtre — un compte comparé à un autre compte, jamais à un nombre écrit en dur, pour que ces
// tests ne mentent pas sur ce qu'ils attendent si une règle de typographie change demain.

// Occurrences d'une espace insécable (U+00A0) dans une sortie HTML.
function compterInsecables(html) {
  return (html.match(/ /g) || []).length;
}

const TEXTE_TYPO = 'Un texte : voici ! Et 10 % de chances.\n';

test('sourcepos : sans szh-sourcepos.lua, plus une seule insécable de typographie', () => {
  const brut = pandoc(TEXTE_TYPO, { de: 'commonmark_x', vers: 'html', filtres: ['szh-typographie.lua'] });
  const attendu = compterInsecables(brut);
  assert.ok(attendu > 0,
    'même commonmark_x tout court ne pose plus d’insécable : le texte d’essai ne prouve plus rien — ' + brut);

  const sansCorrectif = pandoc(TEXTE_TYPO,
    { de: 'commonmark_x+sourcepos', vers: 'html', filtres: ['szh-typographie.lua'] });
  assert.strictEqual(compterInsecables(sansCorrectif), 0,
    'une insécable est posée malgré le Span d’enveloppe : le défaut mesuré le 11.09.2026 '
    + 'n’existe plus, revoir le filtre — ' + sansCorrectif);
});

test('sourcepos : szh-sourcepos.lua en tête pose autant d’insécables qu’en commonmark_x nu', () => {
  const attendu = compterInsecables(
    pandoc(TEXTE_TYPO, { de: 'commonmark_x', vers: 'html', filtres: ['szh-typographie.lua'] }));
  const avecCorrectif = pandoc(TEXTE_TYPO,
    { de: 'commonmark_x+sourcepos', vers: 'html', filtres: ['szh-sourcepos.lua', 'szh-typographie.lua'] });
  assert.strictEqual(compterInsecables(avecCorrectif), attendu,
    'le compte sous sourcepos ne rejoint plus celui de commonmark_x nu (' + attendu + ') : ' + avecCorrectif);
});

// Règles d'abréviation (E4, szh-typographie.lua) : la troisième déformation de sourcepos,
// et la plus fine. « p. ex. » et « pp. 12-25 » n'obtiennent leur insécable que si les Str
// que sourcepos a isolés un à un — « p », « . », « ex », « . » — sont redevenus deux Str
// entiers, « p. » et « ex. » : sort_de_l_espace() les lit alors comme deux INLINES voisins
// d'un Space, exactement comme sous le lecteur `markdown` de la chaîne PDF. Sans ce
// recollage, chaque signe reste séparé et aucune règle ne les revoit côte à côte.
const TEXTE_ABREV = 'Texte avec p. ex. et pp. 12-25.\n';

test('sourcepos : sans le recollage, « p. » et « pp. » restent sans insécable', () => {
  const sansCorrectif = pandoc(TEXTE_ABREV,
    { de: 'commonmark_x+sourcepos', vers: 'html', filtres: ['szh-typographie.lua'] });
  assert.strictEqual(compterInsecables(sansCorrectif), 0,
    'une insécable subsiste malgré le mot coupé en plusieurs Str : ' + sansCorrectif);
});

test('sourcepos : avec szh-sourcepos.lua, « p. » et « pp. » retrouvent leur insécable', () => {
  const avecCorrectif = pandoc(TEXTE_ABREV,
    { de: 'commonmark_x+sourcepos', vers: 'html', filtres: ['szh-sourcepos.lua', 'szh-typographie.lua'] });
  assert.match(avecCorrectif, /p\. ex\./, 'aucune insécable entre « p. » et « ex. » : ' + avecCorrectif);
  assert.match(avecCorrectif, /pp\. 12/, 'aucune insécable entre « pp. » et « 12 » : ' + avecCorrectif);
});

// ── szh-citations.lua sous sourcepos : aplatir() et le sentinelle \1 ───────────────────
// aplatir() (szh-citations.lua) écrit l'octet \1 pour tout inline qui n'est ni Str ni Space,
// et aucun motif d'appel ne le traverse : sous sourcepos, un Span « wrapper=1 » enveloppe
// CHAQUE mot, donc le texte plat d'un paragraphe entier n'est plus qu'une suite de \1 — 0
// appel détecté, 0 lien posé — alors même que la bibliographie elle-même (un Div ordinaire,
// jamais enveloppé) se résout normalement. Mesuré le 11.09.2026 sur l'article d'essai : 3
// appels et 2 liens dans le PDF, 0 et 0 dans l'aperçu.
//
// Lance pandoc DEPUIS un dossier jetable, comme pandocDansDossier plus haut : szh-citations.lua
// lit sa bibliographie par io.open(src), un chemin relatif au cwd de pandoc, jamais par
// --metadata-file — un essai par stdin ne peut donc pas nourrir cette lecture. Généralisée à
// PLUSIEURS filtres et à une sortie HTML, ce que pandocDansDossier ne fait pas : c'est en
// HTML que se lit un <a href="#ref-…">, et la chaîne d'aperçu réelle chaîne toujours
// szh-sourcepos.lua à un autre filtre, jamais seul.
function pandocApercuDansDossier(fichiers, principal, filtres) {
  const dossier = dossierJetable('szh-sourcepos-');
  try {
    for (const nom of Object.keys(fichiers)) {
      fs.writeFileSync(path.join(dossier, nom), fichiers[nom], 'utf8');
    }
    const args = ['--from=commonmark_x+sourcepos', '--to=html', '--wrap=none'];
    for (const f of filtres) { args.push('--lua-filter=' + path.join(FILTRES, f)); }
    args.push(principal);
    const r = spawnSync('pandoc', args, { cwd: dossier, encoding: 'utf8' });
    if (r.error) { throw new Error('pandoc introuvable : ' + r.error.message); }
    if (r.status !== 0) { throw new Error('pandoc a échoué : ' + r.stderr); }
    // Même raison qu'ailleurs dans ce fichier : un pandoc natif Windows imprime du CRLF.
    return (r.stdout || '').replace(/\r\n/g, '\n');
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

const ESSAI_CITATIONS = '---\nlang: fr\n---\n\nUn texte, (Dupont, 2020) le montre bien.\n\n'
  + '::: {.szh-biblio src="essai.biblio.md"}\n:::\n';
const BIBLIO_CITATIONS = 'Dupont, J. (2020). Un titre. Éditions.\n';

test('sourcepos : sans le correctif, l’appel n’est plus lié à sa référence', () => {
  const html = pandocApercuDansDossier(
    { 'essai.md': ESSAI_CITATIONS, 'essai.biblio.md': BIBLIO_CITATIONS },
    'essai.md', ['szh-citations.lua']);
  assert.ok(!/href="#ref-/.test(html),
    'un lien vers la bibliographie subsiste malgré l’enveloppe : ' + html);
  // La bibliographie, elle, n'est PAS enveloppée (un Div ordinaire, résolu par une lecture
  // de fichier et non par une traversée d'inlines) : elle doit donc survivre intacte. Sans
  // cette assertion, un szh-citations.lua qui casserait tout — liste comprise — passerait le
  // test du dessus par accident, sans que rien ne le dise.
  assert.match(html, /id="ref-dupont-2020"/,
    'même l’entrée de bibliographie a disparu : ce test ne cible plus ce qu’il croit cibler — ' + html);
});

test('sourcepos : avec szh-sourcepos.lua, l’appel retrouve son lien vers la référence', () => {
  const html = pandocApercuDansDossier(
    { 'essai.md': ESSAI_CITATIONS, 'essai.biblio.md': BIBLIO_CITATIONS },
    'essai.md', ['szh-sourcepos.lua', 'szh-citations.lua']);
  assert.match(html, /<a href="#ref-dupont-2020"[^>]*class="szh-appel">\(Dupont, 2020\)<\/a>/,
    'l’appel n’est plus lié à sa référence : ' + html);
});

// ── szh-grille.lua sous sourcepos : l'invariant le plus fort, faute de pouvoir tester « sans » ─
// Le correctif (sans_enveloppe(), qui traverse les Div « wrapper=1 » d'un paragraphe d'images)
// est déjà dans szh-grille.lua : impossible donc de rejouer ici le « sans » de ce défaut-là,
// à la différence de tout ce qui précède dans ce fichier. Ce qui reste, et qui dure : la
// sortie sous sourcepos doit être IDENTIQUE à celle sous commonmark_x nu, une fois retirés
// des deux côtés les seuls attributs que sourcepos ajoute (data-pos, data-wrapper). Un futur
// changement qui romprait cette égalité — un flex-grow décalé, une case en moins, un id qui
// change — se verrait ici, même si personne n'a pensé à l'aperçu en l'écrivant.
const GRILLE_DEUX_IMAGES = '::: {.szh-grille}\n'
  + '![Légende de la figure](a.png){alt="Description a"}\n'
  + '![](b.png){alt="Description b"}\n'
  + ':::\n';

// Retire ce que SEUL sourcepos ajoute, pour comparer les deux sorties à armes égales.
function sansAttributsSourcepos(html) {
  return html.replace(/\r\n/g, '\n')
    .replace(/\s*data-pos="[^"]*"/g, '')
    .replace(/\s*data-wrapper="1"/g, '');
}

test('grille (préparation) : la classe szh-grille-rangee est bien posée sous commonmark_x nu', () => {
  // Sans cette préparation, l'égalité ci-dessous passerait aussi si szh-grille.lua ne
  // composait plus AUCUNE rangée, des deux côtés à la fois — un accident qu'elle seule
  // empêche de traverser en silence.
  const html = pandoc(GRILLE_DEUX_IMAGES, { de: 'commonmark_x', vers: 'html', filtres: ['szh-grille.lua'] });
  assert.match(html, /szh-grille-rangee/, 'la grille ne compose plus de rangée : ' + html);
});

test('grille : sous sourcepos, une fois data-pos et data-wrapper retirés, sortie identique à commonmark_x nu', () => {
  const plain = pandoc(GRILLE_DEUX_IMAGES, { de: 'commonmark_x', vers: 'html', filtres: ['szh-grille.lua'] });
  const sousSourcepos = pandoc(GRILLE_DEUX_IMAGES,
    { de: 'commonmark_x+sourcepos', vers: 'html', filtres: ['szh-sourcepos.lua', 'szh-grille.lua'] });
  assert.strictEqual(sansAttributsSourcepos(sousSourcepos), sansAttributsSourcepos(plain),
    'la grille composée sous sourcepos diverge de celle composée sous commonmark_x nu :\n'
    + sansAttributsSourcepos(sousSourcepos) + '\n≠\n' + sansAttributsSourcepos(plain));
});

// ── Les positions de BLOC survivent : le garde-fou contre une correction de trop ───────
// szh-sourcepos.lua ne défait QUE les Span « wrapper=1 » (les mots) : les Div « wrapper=1 »
// (les blocs imbriqués) restent, à dessein — voir son commentaire de tête. C'est de ces Div
// que pandoc tire le data-pos qu'il fond dans l'élément qu'ils contiennent à l'écriture :
// le <p>, le <h2>, le <ul> ou le <div> qui en sort porte l'attribut dont media/apercu.js a
// besoin pour le clic vers la source. Déballer aussi ces Div-là — la correction la plus
// tentante, puisqu'ils portent le même attribut que les Span — ferait tomber les blocs
// positionnés de 9 à 2 sur l'article d'essai (mesuré le 11.09.2026) : le clic ne marcherait
// plus que sur les titres. Ce test est le seul qui s'en apercevrait.
const DOC_POSITIONS = '## Titre\n\nParagraphe.\n\n- Un\n- Deux\n\n::: {.encadre}\nTexte.\n:::\n';

test('sourcepos : un data-pos de bloc reste sur <p>, <h2>, <ul> et <div>', () => {
  const html = pandoc(DOC_POSITIONS, { de: 'commonmark_x+sourcepos', vers: 'html', filtres: ['szh-sourcepos.lua'] });
  assert.match(html, /<h2[^>]*\sdata-pos="/, 'le titre a perdu sa position de bloc : ' + html);
  assert.match(html, /<p[^>]*\sdata-pos="/, 'le paragraphe a perdu sa position de bloc : ' + html);
  assert.match(html, /<ul[^>]*\sdata-pos="/, 'la liste a perdu sa position de bloc : ' + html);
  assert.match(html, /<div[^>]*\sdata-pos="/, 'le div fencé a perdu sa position de bloc : ' + html);
});

// ── `markdown+sourcepos` n'existe pas : ce qui force tout ce qui précède ───────────────
// Si l'aperçu pouvait lire en `markdown+sourcepos`, il n'aurait pas besoin de commonmark_x,
// et rien de ce fichier — ni szh-sourcepos.lua, ni les treize tests qui précèdent — n'aurait
// de raison d'exister. Ce test documente la contrainte de départ plutôt que de la supposer :
// si pandoc apprenait un jour sourcepos pour markdown, il serait le premier à le dire.
test('sourcepos : le lecteur markdown ne connaît pas l’extension sourcepos', () => {
  assert.throws(() => pandoc('Un texte.\n', { de: 'markdown+sourcepos', vers: 'html' }),
    /sourcepos/,
    'pandoc accepte maintenant markdown+sourcepos : l’aperçu peut abandonner commonmark_x');
});

// ── szh-ancres.lua : l'identifiant d'un titre, le même des deux côtés ─────────────────
//
// L'autre écart entre les deux chaînes n'a rien à voir avec sourcepos : les lecteurs
// `markdown` et `commonmark` ne fabriquent pas l'identifiant d'un titre de la même façon dès
// qu'il porte de la ponctuation. Sur les 4661 titres du corpus du dépôt, 1460 portaient dans
// l'aperçu une ancre que le PDF n'a jamais eue (11.09.2026) — et les articles de
// documentation ouvrent sur une table des matières faite de liens « [Rubrique](#rubrique) ».
// Ces liens menaient au bon endroit dans le PDF et nulle part dans l'aperçu, sans un mot :
// un lien mort ne se plaint pas.
//
// szh-ancres.lua ne réécrit pas la règle, il la demande à pandoc. Ces tests comparent donc
// toujours l'aperçu à ce que le lecteur `markdown` produit, jamais à une chaîne écrite à la
// main : le jour où pandoc changera d'algorithme, les deux bougeront ensemble.

// Les identifiants des titres d'une sortie HTML, dans l'ordre du document.
function ancresDesTitres(html) {
  return (html.match(/<h[1-6][^>]*\sid="[^"]*"/g) || [])
    .map((b) => b.match(/\sid="([^"]*)"/)[1]);
}

const TITRES_PONCTUES = '## Titre principal : le grand\n\n## Fachbücher & Filme\n\n## 50 % des élèves\n';

test('ancres (préparation) : sans le filtre, l’aperçu ne donne pas les ancres du PDF', () => {
  const pdf = ancresDesTitres(pandoc(TITRES_PONCTUES, { de: 'markdown', vers: 'html' }));
  const apercu = ancresDesTitres(pandoc(TITRES_PONCTUES, { de: 'commonmark_x+sourcepos', vers: 'html' }));
  assert.strictEqual(pdf.length, apercu.length, 'les deux lecteurs ne font plus le même nombre de titres');
  assert.notDeepStrictEqual(apercu, pdf,
    'les deux lecteurs s’accordent désormais sur ces titres : le défaut a disparu de pandoc, '
    + 'szh-ancres.lua n’a plus de raison d’être — ' + JSON.stringify(apercu));
});

test('ancres : avec szh-ancres.lua, l’aperçu porte exactement les ancres du PDF', () => {
  const pdf = ancresDesTitres(pandoc(TITRES_PONCTUES, { de: 'markdown', vers: 'html' }));
  const apercu = ancresDesTitres(pandoc(TITRES_PONCTUES,
    { de: 'commonmark_x+sourcepos', vers: 'html', filtres: ['szh-sourcepos.lua', 'szh-ancres.lua'] }));
  assert.deepStrictEqual(apercu, pdf,
    'un lien de table des matières ne mènera pas au même endroit dans l’aperçu et dans le PDF');
});

// Un identifiant écrit à la main — ce que posent les tables des matières converties depuis
// Word — ne doit JAMAIS être réécrit : le lien qui le vise est écrit à la main lui aussi.
// szh-ancres.lua le reconnaît en recalculant ce que commonmark AURAIT posé et en ne touchant
// au titre que si c'est exactement ce qu'il porte.
test('ancres : un identifiant écrit à la main est laissé tel quel', () => {
  const html = pandoc('## Un titre quelconque : ici {#mon-ancre-a-moi}\n',
    { de: 'commonmark_x+sourcepos', vers: 'html', filtres: ['szh-sourcepos.lua', 'szh-ancres.lua'] });
  assert.deepStrictEqual(ancresDesTitres(html), ['mon-ancre-a-moi'],
    'l’ancre écrite à la main a été réécrite : tous les liens qui la visent sont morts — ' + html);
});

// Deux titres identiques : pandoc suffixe le second par -1, le troisième par -2, dans
// l'ordre du document. szh-ancres.lua tient DEUX compteurs en parallèle, celui de commonmark
// et celui de markdown — sans quoi le deuxième « Même titre » porterait « meme-titre-1 » face
// à un calcul qui rend « meme-titre », et passerait pour une ancre écrite à la main.
test('ancres : des titres en double reçoivent les mêmes suffixes que dans le PDF', () => {
  const doubles = '## Même titre : deux points\n\n## Même titre : deux points\n\n## Même titre : deux points\n';
  const pdf = ancresDesTitres(pandoc(doubles, { de: 'markdown', vers: 'html' }));
  const apercu = ancresDesTitres(pandoc(doubles,
    { de: 'commonmark_x+sourcepos', vers: 'html', filtres: ['szh-sourcepos.lua', 'szh-ancres.lua'] }));
  assert.strictEqual(new Set(pdf).size, 3, 'pandoc ne désambiguïse plus les titres en double : ' + pdf);
  assert.deepStrictEqual(apercu, pdf, 'les doublons ne sont plus numérotés pareil des deux côtés');
});

// ── Rubriques de la Documentation : rangs de titre et numérotation ─────────────────────
//
// Le titre d'une rubrique est posé par szh-rubrique.lua, tout en fin de chaîne. Ce qui
// précède doit donc laisser tranquille ce que le rédacteur écrit DANS le bloc :
// szh-niveaux.lua ne le compacte pas, szh-sections.lua ne le numérote pas, et
// szh-rubrique.lua rabat les rangs sous son propre <h2>. Les trois vont ensemble : défaire
// l'un seul rend « 1 International » ou un plan à deux rangs identiques.
//
// Constaté sur la Documentation allemande du 2027-02, dont la Rundschau sortait
// « 1 International » / « 1.1 Schweizer Engagement… ».

const CHAINE_RUBRIQUE = ['szh-niveaux.lua', 'szh-sections.lua', 'szh-rubrique.lua'];

function rendreRubrique(md) {
  return pandoc(md, { de: 'markdown', vers: 'html5', filtres: CHAINE_RUBRIQUE });
}

// `##` dans le bloc et `##` hors du bloc : les deux entrent en h2 dans l'AST, et c'est
// bien le contexte — et lui seul — qui doit les séparer.
const MD_RUBRIQUE = [
  '::: {#b1 .szh-rubrique type="tour-horizon"}',
  '## International',
  '',
  '### Une brève',
  '',
  'Du texte.',
  ':::',
  '',
  '## Une vraie section',
  '',
  '### Sa sous-section'
].join('\n');

test('rubrique : les titres du bloc ne sont pas numérotés, ceux de l’article le restent', () => {
  const html = rendreRubrique(MD_RUBRIQUE);
  // Le corps seul : s'arrêter au texte de la section suivante engloberait son propre
  // numéro, qui la précède dans le HTML — le contrôle passerait pour de mauvaises raisons.
  const debut = html.indexOf('szh-rubrique-corps');
  const dans = html.slice(debut, html.indexOf('</div>', debut));
  assert.ok(!/szh-num-section/.test(dans),
    'un titre de rubrique est numéroté : szh-sections.lua doit s’arrêter au seuil du bloc');
  assert.match(html, /<h2[^>]*>\s*<span[^>]*szh-num-section[^>]*>1\s*<\/span>Une vraie section/,
    'la vraie section de l’article doit, elle, garder son numéro');
});

test('rubrique : le titre du bloc est un h2, son contenu commence à h3, sans saut de rang', () => {
  const html = rendreRubrique(MD_RUBRIQUE);
  assert.match(html, /<h2 class="szh-rubrique-titre"[^>]*>Tour d/,
    'le titre de la rubrique doit rester un h2 posé par le filtre');
  const corps = html.slice(html.indexOf('szh-rubrique-corps'), html.indexOf('</div>'));
  const rangs = (corps.match(/<h(\d)/g) || []).map((t) => Number(t.slice(2)));
  assert.deepStrictEqual(rangs, [3, 4],
    'le « ## » du bloc doit descendre en h3 et le « ### » en h4, sous le h2 de la rubrique');
});

test('rubrique : un bloc écrit en ### et #### donne les mêmes rangs qu’en ## et ###', () => {
  const profond = MD_RUBRIQUE.replace('## International', '### International')
    .replace('### Une brève', '#### Une brève');
  const rangsDe = (md) => {
    const html = rendreRubrique(md);
    const corps = html.slice(html.indexOf('szh-rubrique-corps'), html.indexOf('</div>'));
    return (corps.match(/<h(\d)/g) || []).map((t) => Number(t.slice(2)));
  };
  assert.deepStrictEqual(rangsDe(profond), rangsDe(MD_RUBRIQUE),
    'le rédacteur ne doit pas avoir à deviner à quel rang commencer');
});

// ⚠ Le piège du writer html5 décrit dans l'en-tête de szh-rubrique.lua : un Div
// d'identifiant vide dont le premier enfant est un Header sort en <section>, et pandoc lui
// déplace l'identifiant de ce Header. Le rabattement des rangs a rendu ce cas courant.
test('rubrique : le corps reste un div et le premier titre garde son ancre', () => {
  const html = rendreRubrique(MD_RUBRIQUE);
  assert.match(html, /<div id="b1-corps" class="szh-rubrique-corps">/,
    'le corps de rubrique doit rester un <div> à identifiant propre');
  assert.match(html, /<h3 id="international">/,
    'le premier titre du bloc a perdu son identifiant : le writer html5 l’a happé');
});

test('rubrique : un bloc sans titre intérieur sort exactement comme avant', () => {
  const html = rendreRubrique(['::: {#b2 .szh-rubrique type="ressources"}', 'Du texte seul.', ':::'].join('\n'));
  assert.match(html, /<h2 class="szh-rubrique-titre"/);
  assert.ok(!/<h3|<h4/.test(html), 'aucun titre ne doit apparaître de nulle part');
  assert.match(html, /Du texte seul\./);
});
