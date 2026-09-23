// Ce que le convertisseur Kirby (pipeline/documentation-kirby.py) écrit, et ce que
// szh-ressource.lua / szh-rubrique.lua en composent une fois passés par pandoc — le même
// harnais que test/filtres-pandoc.test.js (pandoc réel, jamais un AST écrit à la main), plus
// un appel à l'interprète Python pour le convertisseur.
//
//   node --test test/documentation-kirby.test.js
//
// ⚠ Hors du glob test/js/*.test.js, comme test/filtres-pandoc.test.js et pour la même
//   raison : ces contrôles demandent pandoc (job `pdf-ua` de la CI), pas le job `contrats`.
//
// Aucun de ces contrôles ne s'abstient silencieusement : pandoc ou python absents -> saut
// explicite via gardes.js (sansPandoc / sansPython), jamais un test qui réussit pour rien.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { sansPandoc, sansPython, PYTHON } = require('./js/gardes');

const RACINE = path.resolve(__dirname, '..');
const FILTRES = path.join(RACINE, 'pipeline', 'filters');
const CONVERTISSEUR = path.join(RACINE, 'pipeline', 'documentation-kirby.py');
const CHAMPS_JSON = path.join(RACINE, 'pipeline', 'kirby', 'champs-documentation.json');
const BANC = path.join(RACINE, 'test', 'articles', 'documentation');
// Bibliothèque partagée du banc (test/README.md, §La bibliothèque de fiches) : test/ n'est
// pas sous Revue\ ni Zeitschrift\, sa racine ne se découvre donc pas seule — passée
// explicitement à chaque appel, jamais via SZH_NEWS_RACINE (déterministe, indépendant de
// l'environnement du poste qui lance les tests).
const BANC_RACINE = path.join(RACINE, 'test', 'news-racine');
const ID_BANC = 'wj7f0dcw97qk3p2s'; // test/ausgabe.yaml : id
const CHAMPS = JSON.parse(fs.readFileSync(CHAMPS_JSON, 'utf8'));

const SAUT = { skip: sansPandoc || sansPython };

function dossierJetable(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
}

// Lance le convertisseur sur un dossier d'article Documentation, TOUJOURS via --sortie
// (jamais stdout, même quand l'appelant ne fournit pas de chemin) : c'est ce que fait
// pipeline/Makefile en production, et c'est nécessaire ici — Python choisit l'encodage de
// stdout sur la locale du système quand il n'écrit pas dans un vrai terminal (cp1252 sur un
// poste Windows francophone/germanophone), alors que le fichier est ouvert par le script
// avec `encoding='utf-8'` explicite (documentation-kirby.py, main()). Sans ce détour, les
// caractères accentués du stdout capturé par spawnSync ressortaient en mojibake — mesuré.
// stderr n'a pas ce problème : jamais lu ici pour son CONTENU accentué, seulement grep-é
// sur des motifs ASCII.
function convertir(dossierArticle, sortieDemandee, racineNews) {
  const dossierTmp = sortieDemandee ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'szh-doc-conv-'));
  const sortie = sortieDemandee || path.join(dossierTmp, 'sortie.md');
  try {
    const args = [CONVERTISSEUR, '--article', dossierArticle, '--champs', CHAMPS_JSON, '--sortie', sortie];
    if (racineNews !== null) { args.push('--racine-news', racineNews === undefined ? BANC_RACINE : racineNews); }
    const r = spawnSync(PYTHON, args, { encoding: 'utf8' });
    if (r.error) { throw new Error('python introuvable : ' + r.error.message); }
    const stdout = (r.status === 0 && fs.existsSync(sortie)) ? fs.readFileSync(sortie, 'utf8') : '';
    return { stdout, stderr: r.stderr, status: r.status };
  } finally {
    if (dossierTmp) { fs.rmSync(dossierTmp, { recursive: true, force: true }); }
  }
}

// pandoc, du markdown déjà en mémoire vers du HTML, avec la chaîne de filtres donnée.
// Reprend l'idiome de test/filtres-pandoc.test.js (pandoc()), copié plutôt qu'importé :
// deux harnais indépendants, l'un pour les filtres seuls, l'autre pour le convertisseur +
// les filtres — voir l'en-tête de ce fichier.
function pandoc(entree, options) {
  const o = options || {};
  const args = ['--from=markdown', '--to=html5', '--wrap=none'];
  if (o.metadataFile) { args.push('--metadata-file=' + o.metadataFile); }
  if (o.resourcePath) { args.push('--resource-path=' + o.resourcePath); }
  for (const f of (o.filtres || [])) { args.push('--lua-filter=' + path.join(FILTRES, f)); }
  const r = spawnSync('pandoc', args, { input: entree, encoding: 'utf8', cwd: o.cwd });
  if (r.error) { throw new Error('pandoc introuvable : ' + r.error.message); }
  if (r.status !== 0) { throw new Error('pandoc a échoué : ' + r.stderr); }
  return r.stdout.replace(/\r\n/g, '\n');
}

// La chaîne réelle du Makefile, réduite aux filtres qui touchent une Documentation (voir
// l'en-tête de pipeline/Makefile pour l'ordre complet et pourquoi) : assez pour composer le
// rendu final d'une fiche ou d'une rubrique, jamais assez pour prouver l'ordre ENTIER — ce
// n'est pas le rôle de ce fichier.
const CHAINE_DOCUMENTATION = [
  'szh-niveaux.lua', 'szh-listes-serrees.lua', 'szh-typographie.lua', 'szh-grille.lua',
  'szh-ressource.lua', 'szh-figure.lua', 'szh-numerotation.lua', 'szh-sections.lua',
  'szh-citations.lua', 'szh-rubrique.lua',
];

// Convertit puis rend le banc réel (test/articles/documentation) : un seul appel, mémoïsé,
// partagé par tous les tests qui l'interrogent — le banc ne change pas d'un test à l'autre.
let _rendu;
function rendreLeBanc() {
  if (_rendu) { return _rendu; }
  const c = convertir(BANC);
  assert.strictEqual(c.status, 0, 'le convertisseur a échoué sur le banc réel : ' + c.stderr);
  const html = pandoc(c.stdout, {
    metadataFile: path.join(BANC, 'documentation.meta.yaml'),
    resourcePath: BANC,
    filtres: CHAINE_DOCUMENTATION,
  });
  _rendu = { md: c.stdout, stderr: c.stderr, html };
  return _rendu;
}

// ── Le convertisseur sur le banc réel ───────────────────────────────────────────────────

test('convertisseur : le banc réel se convertit sans avertissement d’ordre', SAUT, () => {
  const c = convertir(BANC);
  assert.strictEqual(c.status, 0, c.stderr);
  assert.ok(!/ne suit pas le tri/.test(c.stderr),
    'le banc doit être écrit dans l’ordre canonique, sinon le test ne prouve rien : ' + c.stderr);
});

test('convertisseur : les dix fiches et les deux rubriques non vides sortent', SAUT, () => {
  const { md } = rendreLeBanc();
  const fiches = md.match(/^::: \{#\S+ \.szh-ressource /gm) || [];
  assert.strictEqual(fiches.length, 10, 'dix fiches attendues : ' + fiches.length);
  assert.match(md, /#doc-dossier_references \.szh-rubrique/);
  assert.match(md, /#doc-dossier_liens \.szh-rubrique/);
});

test('convertisseur : une rubrique sans contenu (podcasts) n’écrit aucun bloc', SAUT, () => {
  const { md } = rendreLeBanc();
  assert.ok(!/type="podcasts"/.test(md), 'un bloc podcasts existe alors que le champ est vide/absent : ' + md);
  assert.ok(!/type="ressources"/.test(md), 'un bloc ressources existe alors que le champ est vide/absent : ' + md);
});

test('convertisseur : title et non titre — l’attribut suit le contrat JSON', SAUT, () => {
  const { md } = rendreLeBanc();
  assert.match(md, /title="Fülle und Grenzen"/);
  assert.ok(!/\btitre="/.test(md), 'un attribut « titre » (ancien nom) est encore écrit : ' + md);
});

test('convertisseur : curia et source voyagent en attribut, jamais dans le texte du md', SAUT, () => {
  const { md } = rendreLeBanc();
  assert.match(md, /curia="8"/, 'curia doit être porté par le convertisseur (Pronto l’a déjà calculé)');
  assert.match(md, /source="manuel"/);
});

// ── Le rendu final (filtres compris) ────────────────────────────────────────────────────

test('rendu : rubrique avec intertitres — rangs rabattus, aucune numérotation', SAUT, () => {
  const { html } = rendreLeBanc();
  assert.match(html, /<h3 id="international">International<\/h3>/);
  assert.match(html, /<h4 id="eine-meldung-mit-einem-titel">/);
  const corps = html.slice(html.indexOf('doc-dossier_references-corps'), html.indexOf('</section>'));
  assert.ok(!/szh-num-section/.test(corps), 'un titre de rubrique porte un numéro de section : ' + corps);
});

test('rendu : rubrique sans intertitre (dossier_liens) sort une liste ordinaire', SAUT, () => {
  const { html } = rendreLeBanc();
  assert.match(html, /<h2 class="szh-rubrique-titre"[^>]*>Linksammlung zum Schwerpunkt<\/h2>/);
  assert.match(html, /<li><a href="https:\/\/www\.szh\.ch\/">szh\.ch<\/a><\/li>/);
});

// Régression du 23.09.2026 : les sections de FICHES (horizon, recherche, intervention…)
// n'avaient aucun titre imprimé — seules les rubriques en portaient un — et les fiches se
// rangeaient visuellement sous le titre de la dernière rubrique. Un titre par section NON
// VIDE, jamais numéroté : c'est ce que compte ce test, sur le compte réel de sections du
// banc (deux rubriques + sept sections de fiches — le banc n'a pas de section de fiches
// vide, voir « une rubrique sans contenu » plus haut pour ce cas côté rubriques).
test('rendu : chaque section non vide (rubrique ou groupe de fiches d’un type) porte un titre imprimé, jamais numéroté', SAUT, () => {
  const { html } = rendreLeBanc();
  const titres = html.match(
    /<h2 class="(?:szh-rubrique-titre|szh-ressources-section-titre)"[^>]*>[\s\S]*?<\/h2>/g) || [];
  const textes = titres.map((t) => t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  assert.deepStrictEqual(textes, [
    'Literatur zum Schwerpunkt', 'Linksammlung zum Schwerpunkt',
    'Rundschau', 'Laufende Forschungsprojekte', 'Parlamentarische Vorstösse',
    'Bücher', 'Filme', 'Blick in die Revue', 'Weiterbildung',
  ], 'un titre de section manque, est en trop, ou dans le mauvais ordre : ' + JSON.stringify(textes));
  for (const t of titres) {
    assert.ok(!/szh-num-section/.test(t), 'un titre de section porte un numéro : ' + t);
  }
});

test('rendu : tour d’horizon international — pas de canton, lien par défaut', SAUT, () => {
  const { html } = rendreLeBanc();
  const bloc = html.slice(html.indexOf('id="horizon001intl00"'), html.indexOf('id="horizon002bern00"'));
  assert.ok(!/szh-ressource-biblio/.test(bloc), 'une ligne biblio existe pour une portée non régionale : ' + bloc);
  assert.match(bloc, /Mehr erfahren: Weltweite Inklusionsstrategie/,
    'le gabarit par défaut de libelleLien (horizon) doit s’appliquer sans lien_libelle');
});

test('rendu : tour d’horizon régional — le canton sort en code, lien_libelle prime', SAUT, () => {
  const { html } = rendreLeBanc();
  const bloc = html.slice(html.indexOf('id="horizon002bern00"'), html.indexOf('id="recherche01date00"'));
  assert.match(bloc, /<div class="szh-ressource-biblio">\s*<p>BE<\/p>/,
    'le canton doit sortir en code (BE), jamais traduit ni développé : ' + bloc);
  assert.match(bloc, /Zur Medienmitteilung des Kantons Bern/,
    'lien_libelle doit primer sur le gabarit libelleLien');
  assert.ok(!/Mehr erfahren/.test(bloc), 'le gabarit par défaut a été utilisé malgré lien_libelle : ' + bloc);
});

test('rendu : recherche — dates partielles en forme suisse compacte', SAUT, () => {
  const { html } = rendreLeBanc();
  const bloc = html.slice(html.indexOf('id="recherche01date00"'), html.indexOf('id="intervent04ch0000"'));
  assert.match(bloc, /<p>Universität Bern, HfH Zürich · 2020 · 03\.2026<\/p>/,
    'une date partielle « 2020 » doit rester « 2020 », « 2026-03 » devenir « 03.2026 » : ' + bloc);
});

test('rendu : intervention CH — état traduit, canton en code, pas de suivi', SAUT, () => {
  const { html } = rendreLeBanc();
  const bloc = html.slice(html.indexOf('id="intervent04ch0000"'), html.indexOf('id="intervent05zha000"'));
  assert.match(bloc, /<p>CH · Postulat · 26\.3001 · 12\.03\.2026<\/p>/);
  assert.match(bloc, /<div class="szh-ressource-etat">\s*<p>In Beratung<\/p>/);
  assert.ok(!/szh-ressource-suivi/.test(bloc), 'un bloc suivi existe sans qu’aucun n’ait été saisi : ' + bloc);
});

test('rendu : intervention ZH — suivi à deux lignes, la première en lien, la seconde sans « : »', SAUT, () => {
  const { html } = rendreLeBanc();
  const bloc = html.slice(html.indexOf('id="intervent05zha000"'), html.indexOf('id="intervent06zhb000"'));
  assert.match(bloc,
    /<p><a href="https:\/\/www\.zh\.ch\/antwort">Stellungnahme vom 20\.08\.2026: Antwort des Regierungsrates<\/a><\/p>/,
    'la première entrée de suivi (avec libellé et lien) doit être une phrase entièrement liée : ' + bloc);
  assert.match(bloc, /<p>Entscheid vom 25\.08\.2026<\/p>/,
    'la seconde entrée (sans libellé) ne doit garder ni « : » ni lien : ' + bloc);
  assert.ok(!/Entscheid vom 25\.08\.2026 :/.test(bloc), 'le « : » du gabarit n’a pas été retiré : ' + bloc);
});

test('rendu : intervention ZH sans descriptif ni suivi — aucun bloc vide ne traîne', SAUT, () => {
  const { html } = rendreLeBanc();
  const bloc = html.slice(html.indexOf('id="intervent06zhb000"'), html.indexOf('id="livre0007buch000"'));
  assert.ok(!/szh-ressource-etat/.test(bloc));
  assert.ok(!/szh-ressource-suivi/.test(bloc));
  assert.match(bloc, /<p>ZH · Motion · 26\.230 · 01\.07\.2026<\/p>/);
});

test('rendu : livre — pastille traduite, image décorative, lien « Mehr zum Buch »', SAUT, () => {
  const { html } = rendreLeBanc();
  const bloc = html.slice(html.indexOf('id="livre0007buch000"'), html.indexOf('id="film0008zaertl00"'));
  assert.match(bloc, /<div class="szh-ressource-pastille">\s*<p>Fachbuch<\/p>/,
    'la pastille (categorie « manuel ») doit être traduite en « Fachbuch » : ' + bloc);
  assert.match(bloc, /szh-decor/, 'l’image de couverture doit être passée en décor par szh-numerotation.lua');
  assert.match(bloc, /Mehr zum Buch Soziale und emotionale Entwicklung im Kindesalter/);
});

test('rendu : film — pastille de catégorie traduite', SAUT, () => {
  const { html } = rendreLeBanc();
  const bloc = html.slice(html.indexOf('id="film0008zaertl00"'), html.indexOf('id="reprise09revue00"'));
  assert.match(bloc, /<div class="szh-ressource-pastille">\s*<p>Dokumentarfilm<\/p>/);
});

// Genre et pays (saisie liste_multiple) : chaque jeton traduit dans la langue de l'article
// (allemand, banc réel) puis joints par « , », intercalés entre année et distributeur —
// ordre réalisateur · année · genre · pays · distributeur (justifié dans szh-ressource.lua).
test('rendu : film — genre et pays (liste_multiple) traduits en allemand, dans l’ordre réalisateur · année · genre · pays · distributeur', SAUT, () => {
  const { html } = rendreLeBanc();
  const bloc = html.slice(html.indexOf('id="film0008zaertl00"'), html.indexOf('id="reprise09revue00"'));
  assert.match(bloc,
    /<div class="szh-ressource-biblio">\s*<p>Boros, A\. · 2025 · Drama, Familienfilm · Deutschland, Schweiz · W-Film<\/p>/,
    'biblio du film attendue (genre et pays traduits en allemand, dans l’ordre attendu) : ' + bloc);
});

test('rendu : reprise — le jeton de revue est développé dans la biblio', SAUT, () => {
  const { html } = rendreLeBanc();
  const bloc = html.slice(html.indexOf('id="reprise09revue00"'), html.indexOf('id="agenda0010tagung0"'));
  assert.match(bloc, /Revue suisse de pédagogie spécialisée/);
  assert.match(bloc, /Zum Artikel L.intégration professionnelle/);
});

test('rendu : agenda — « 13\\. » reste un paragraphe, jamais une liste', SAUT, () => {
  const { html } = rendreLeBanc();
  const bloc = html.slice(html.indexOf('id="agenda0010tagung0"'));
  assert.match(bloc, /<p>13\. Internationale Tagung/, 'le nombre échappé doit rester en tête de paragraphe : ' + bloc);
  assert.ok(!/<ol>/.test(bloc), 'le « 13. » a été lu comme le départ d’une liste numérotée : ' + bloc);
});

test('rendu : agenda — la plage de dates se fond comme ailleurs dans le corpus', SAUT, () => {
  const { html } = rendreLeBanc();
  const bloc = html.slice(html.indexOf('id="agenda0010tagung0"'));
  assert.match(bloc, /02\.–06\.10\.2026/);
});

test('rendu : curia et source ne s’impriment jamais, nulle part dans le document', SAUT, () => {
  const { html } = rendreLeBanc();
  assert.ok(!/>\s*8\s*</.test(html), 'un curia isolé (8) apparaît en texte : suspect');
  assert.ok(!/\bcuria\b/i.test(html), '« curia » apparaît dans le texte imprimé : ' + html);
  assert.ok(!/Curia Vista|Manuell erfasst/.test(html), 'un libellé de la liste « source » apparaît imprimé : ' + html);
});

// ── Un numéro et sa bibliothèque, jetables ──────────────────────────────────────────────
// Pour les cas qui doivent exercer une VRAIE bibliothèque de fiches (Ordre, Ausgabe,
// orpheline, statut…) sans dépendre du banc réel : un dossier de numéro (ausgabe.yaml +
// article Documentation minimal) et un dossier de racine _NewsUndActu, jetables l'un et
// l'autre, jamais confondus avec le banc (BANC_RACINE), qu'aucun de ces tests ne modifie.

// Numéro jetable seul (ausgabe.yaml + article Documentation minimal), sans bibliothèque —
// pour les cas qui pointent --racine-news sur une bibliothèque existante (BANC_RACINE).
function numeroJetable(id, lang) {
  const dossierNumero = dossierJetable('szh-doc-numero-');
  fs.writeFileSync(path.join(dossierNumero, 'ausgabe.yaml'), `id: ${id}\n`);
  const article = path.join(dossierNumero, 'articles', 'essai');
  fs.mkdirSync(article, { recursive: true });
  fs.writeFileSync(path.join(article, 'essai.meta.yaml'), `type: documentation\nlang: ${lang}\n`);
  fs.writeFileSync(path.join(article, `documentation.${lang}.txt`), 'Title: Essai\n');
  return { article, nettoyer: () => fs.rmSync(dossierNumero, { recursive: true, force: true }) };
}

// Numéro + bibliothèque, jetables l'un et l'autre — pour les cas qui doivent ÉCRIRE des
// fiches (Ordre, Ausgabe…) sans toucher à BANC_RACINE (partagée, jamais modifiée ici).
function numeroEtRacineJetables(id, lang) {
  const { article, nettoyer: nettoyerNumero } = numeroJetable(id, lang);
  const racineFiches = dossierJetable('szh-doc-racine-');
  return {
    article, racineFiches,
    nettoyer() {
      nettoyerNumero();
      fs.rmSync(racineFiches, { recursive: true, force: true });
    },
  };
}

// Fiches\<dossier du type>\<slug>\<fichier> (types[].dossier du contrat, docs/FORMAT-
// DOCUMENTATION-KIRBY.md, §Une fiche, 23.09.2026) : le dossier de type se déduit du type
// porté par le nom du fichier (« livre.de.txt » -> type livre -> dossier buecher), sauf
// `dossierSurcharge` — utilisé par les tests qui rangent volontairement un fichier sous le
// mauvais dossier ou sous un sous-dossier inconnu du contrat.
function ecrireFiche(racineFiches, slug, fichier, contenu, dossierSurcharge) {
  const type = fichier.split('.', 1)[0];
  const dossierType = dossierSurcharge || (CHAMPS.types[type] && CHAMPS.types[type].dossier);
  if (!dossierType) { throw new Error(`ecrireFiche : type « ${type} » absent du contrat et aucun dossierSurcharge fourni`); }
  const dossier = path.join(racineFiches, '_NewsUndActu', 'Fiches', dossierType, slug);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, fichier), contenu);
}

// ── Film : genre et pays (liste_multiple) — l'autre langue, et un jeton inconnu ─────────
//
// Le banc réel (rendreLeBanc, plus haut) n'existe qu'en allemand : ces deux tests exercent
// le français, hors du banc, avec un numéro et une bibliothèque jetables (comme la section
// suivante) — et le cas d'un jeton hors de la liste genre_film/pays du contrat, qui ne doit
// jamais disparaître ni faire échouer la compilation (documentation-kirby.py transporte la
// valeur brute sans la valider ; szh-ressource.lua imprime tel quel ce qu'il ne reconnaît
// pas — même principe que le repli d'un jeton de liste simple inconnu).
function ficheFilm(id, genre, pays) {
  return `Title: Film de test\n\n----\n\nAusgabe: ${id}\n\n----\n\nOrdre: 1\n\n` +
    `----\n\nCategorie: documentaire\n\n----\n\nGenre: ${genre}\n\n----\n\nPays: ${pays}\n\n` +
    `----\n\nRealisateur: X\n\n----\n\nAnnee: 2026\n\n----\n\nDescriptif: Z\n`;
}

// pandoc() (plus bas dans ce fichier) prend un metadataFile ; pour ces deux tests, un bloc
// front-matter YAML directement dans le markdown suffit (pandoc le lit tout aussi bien) et
// évite d'écrire un fichier .yaml jetable de plus.
function pandocAvecLang(md, lang) {
  return pandoc(`---\nlang: ${lang}\n---\n\n${md}`, { filtres: CHAINE_DOCUMENTATION });
}

test('rendu : film — genre et pays traduits en français dans un numéro français', SAUT, () => {
  const id = 'szhdocfilmfr00001';
  const { article, racineFiches, nettoyer } = numeroEtRacineJetables(id, 'fr');
  try {
    ecrireFiche(racineFiches, 'un-film', 'film.fr.txt', ficheFilm(id, 'drame, familial', 'DE, CH'));
    const c = convertir(article, null, racineFiches);
    assert.strictEqual(c.status, 0, c.stderr);
    const html = pandocAvecLang(c.stdout, 'fr');
    assert.match(html, /<p>X · 2026 · Drame, Film familial · Allemagne, Suisse<\/p>/,
      'genre et pays doivent être traduits en français, dans le même ordre qu’en allemand : ' + html);
  } finally {
    nettoyer();
  }
});

test('rendu : film — un jeton de genre ou de pays absent de la liste du contrat s’imprime tel quel', SAUT, () => {
  const id = 'szhdocfilminc0001';
  const { article, racineFiches, nettoyer } = numeroEtRacineJetables(id, 'fr');
  try {
    ecrireFiche(racineFiches, 'un-film', 'film.fr.txt',
      ficheFilm(id, 'drame, jeton-inconnu-xyz', 'CH, ZZ-inconnu'));
    const c = convertir(article, null, racineFiches);
    assert.strictEqual(c.status, 0, c.stderr);
    const html = pandocAvecLang(c.stdout, 'fr');
    assert.match(html, /Drame, jeton-inconnu-xyz/,
      'un jeton de genre inconnu doit sortir tel quel, jamais disparaître : ' + html);
    assert.match(html, /Suisse, ZZ-inconnu/,
      'un jeton de pays inconnu doit sortir tel quel, jamais disparaître : ' + html);
  } finally {
    nettoyer();
  }
});

// ── L'ordre des fiches : contrôlé, jamais retrié en silence ────────────────────────────

test('convertisseur : un Ordre qui contredit le tri du contrat avertit sur stderr', SAUT, () => {
  const id = 'szhdocordretest1';
  const { article, racineFiches, nettoyer } = numeroEtRacineJetables(id, 'de');
  try {
    // livre (ordreTypes : après intervention) posé en Ordre 1, une intervention en Ordre 2 :
    // contredit ordreTypes (intervention doit précéder livre).
    ecrireFiche(racineFiches, 'un-livre', 'livre.de.txt',
      `Title: Un livre\n\n----\n\nAusgabe: ${id}\n\n----\n\nOrdre: 1\n\n----\n\nAuteurs: X\n\n----\n\nAnnee: 2026\n\n----\n\nEditeur: Y\n\n----\n\nDescriptif: Z\n`);
    ecrireFiche(racineFiches, 'une-intervention', 'intervention.de.txt',
      `Title: Une intervention\n\n----\n\nAusgabe: ${id}\n\n----\n\nOrdre: 2\n\n----\n\nCanton: ZH\n\n----\n\nCategorie: motion\n\n----\n\nNumero: 1\n\n----\n\nDate: 2026-01-01\n`);
    const c = convertir(article, null, racineFiches);
    assert.strictEqual(c.status, 0, c.stderr);
    assert.match(c.stderr, /ne suit pas le tri du contrat/,
      'aucun avertissement alors que Ordre contredit ordreTypes : ' + c.stderr);
  } finally {
    nettoyer();
  }
});

test('convertisseur : Ordre absent sur une fiche — avertissement, repli sur le tri du contrat', SAUT, () => {
  const id = 'szhdocordretest2';
  const { article, racineFiches, nettoyer } = numeroEtRacineJetables(id, 'de');
  try {
    ecrireFiche(racineFiches, 'sans-ordre', 'agenda.de.txt',
      `Title: Sans ordre\n\n----\n\nAusgabe: ${id}\n\n----\n\nEvenement: cours\n\n----\n\nDebut: 2026-01-01\n\n----\n\nFin: 2026-01-02\n\n----\n\nLieu: X\n\n----\n\nOrganisateur: Y\n\n----\n\nDescriptif: Z\n`);
    const c = convertir(article, null, racineFiches);
    assert.strictEqual(c.status, 0, c.stderr);
    assert.match(c.stderr, /Ordre absent/, 'aucun avertissement pour une fiche sans Ordre : ' + c.stderr);
    assert.match(c.stdout, /Sans ordre/, 'la fiche doit quand même sortir : ' + c.stdout);
  } finally {
    nettoyer();
  }
});

test('convertisseur : deux fiches au même Ordre — avertissement de doublon', SAUT, () => {
  const id = 'szhdocordretest3';
  const { article, racineFiches, nettoyer } = numeroEtRacineJetables(id, 'de');
  try {
    ecrireFiche(racineFiches, 'agenda-a', 'agenda.de.txt',
      `Title: A\n\n----\n\nAusgabe: ${id}\n\n----\n\nOrdre: 1\n\n----\n\nEvenement: cours\n\n----\n\nDebut: 2026-01-01\n\n----\n\nFin: 2026-01-02\n\n----\n\nLieu: X\n\n----\n\nOrganisateur: Y\n\n----\n\nDescriptif: Z\n`);
    ecrireFiche(racineFiches, 'agenda-b', 'agenda.de.txt',
      `Title: B\n\n----\n\nAusgabe: ${id}\n\n----\n\nOrdre: 1\n\n----\n\nEvenement: cours\n\n----\n\nDebut: 2026-01-01\n\n----\n\nFin: 2026-01-02\n\n----\n\nLieu: X\n\n----\n\nOrganisateur: Y\n\n----\n\nDescriptif: Z\n`);
    const c = convertir(article, null, racineFiches);
    assert.strictEqual(c.status, 0, c.stderr);
    assert.match(c.stderr, /Ordre en double/, 'aucun avertissement pour deux fiches au même Ordre : ' + c.stderr);
  } finally {
    nettoyer();
  }
});

// ── Fiches\<dossier du type>\ : sous-dossier inconnu, fichier dans le mauvais dossier ──────

test('convertisseur : un sous-dossier de Fiches inconnu du contrat est ignoré, avec un avertissement', SAUT, () => {
  const id = 'szhdocdossierx01';
  const { article, racineFiches, nettoyer } = numeroEtRacineJetables(id, 'de');
  try {
    ecrireFiche(racineFiches, 'une-fiche', 'agenda.de.txt',
      `Title: Perdue\n\n----\n\nAusgabe: ${id}\n\n----\n\nOrdre: 1\n\n----\n\nEvenement: cours\n\n----\n\nDebut: 2026-01-01\n\n----\n\nFin: 2026-01-02\n\n----\n\nLieu: X\n\n----\n\nOrganisateur: Y\n\n----\n\nDescriptif: Z\n`,
      'DossierInconnu');
    const c = convertir(article, null, racineFiches);
    assert.strictEqual(c.status, 0, c.stderr);
    assert.match(c.stderr, /sous-dossier inconnu/, 'aucun avertissement pour Fiches/DossierInconnu : ' + c.stderr);
    assert.ok(!/Perdue/.test(c.stdout), 'la fiche d’un sous-dossier inconnu ne doit pas sortir : ' + c.stdout);
  } finally {
    nettoyer();
  }
});

test('convertisseur : un fichier de langue rangé sous le dossier d’un autre type est signalé et jamais lu', SAUT, () => {
  const id = 'szhdocdossierx02';
  const { article, racineFiches, nettoyer } = numeroEtRacineJetables(id, 'de');
  try {
    // livre.de.txt (type livre, dossier buecher) rangé sous filme (le dossier du type film).
    ecrireFiche(racineFiches, 'un-livre-egare', 'livre.de.txt',
      `Title: Livre égaré\n\n----\n\nAusgabe: ${id}\n\n----\n\nOrdre: 1\n\n----\n\nAuteurs: X\n\n----\n\nAnnee: 2026\n\n----\n\nEditeur: Y\n\n----\n\nDescriptif: Z\n`,
      'filme');
    const c = convertir(article, null, racineFiches);
    assert.strictEqual(c.status, 0, c.stderr);
    assert.match(c.stderr, /rangé sous le dossier/, 'aucun signalement pour un fichier dans le mauvais dossier de type : ' + c.stderr);
    assert.ok(!/Livre égaré/.test(c.stdout), 'un fichier rangé sous le mauvais dossier de type ne doit jamais être lu : ' + c.stdout);
  } finally {
    nettoyer();
  }
});

test('convertisseur : documentation.<lang>.txt absent — échec net, message clair', SAUT, () => {
  const dossier = dossierJetable('szh-doc-absent-');
  try {
    fs.writeFileSync(path.join(dossier, 'documentation.meta.yaml'), 'type: documentation\nlang: fr\n');
    const c = convertir(dossier, null, null);
    assert.notStrictEqual(c.status, 0, 'le convertisseur doit échouer sans documentation.fr.txt');
    assert.match(c.stderr, /introuvable/);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test('convertisseur : ausgabe.yaml sans id — échec net, message clair', SAUT, () => {
  const dossier = dossierJetable('szh-doc-sansid-');
  try {
    fs.writeFileSync(path.join(dossier, 'ausgabe.yaml'), 'title: "sans id"\n');
    const article = path.join(dossier, 'articles', 'essai');
    fs.mkdirSync(article, { recursive: true });
    fs.writeFileSync(path.join(article, 'essai.meta.yaml'), 'type: documentation\nlang: fr\n');
    fs.writeFileSync(path.join(article, 'documentation.fr.txt'), 'Title: X\n');
    const c = convertir(article, null, null);
    assert.notStrictEqual(c.status, 0, 'le convertisseur doit échouer sans id dans ausgabe.yaml');
    assert.match(c.stderr, /id/i);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

// ── La bibliothèque partagée : orpheline, fiche bilingue, statut, numéro archivé ───────

test('convertisseur : une orpheline (Ausgabe vide) n’apparaît dans aucun numéro', SAUT, () => {
  const c = convertir(BANC); // le banc réel : Ausgabe = ID_BANC
  assert.strictEqual(c.status, 0, c.stderr);
  assert.ok(!/orpheline-sans-numero|Fiche orpheline/.test(c.stdout),
    'la fiche orpheline de test/news-racine apparaît alors que son Ausgabe est vide : ' + c.stdout);
});

test('convertisseur : une fiche bilingue est vue dans sa seule langue, par le seul numéro auquel son fichier de langue est rattaché', SAUT, () => {
  const fr = numeroJetable('autrenumfr000001', 'fr');
  const de = numeroJetable('autrenumde000002', 'de');
  try {
    const cFr = convertir(fr.article, null, BANC_RACINE);
    assert.strictEqual(cFr.status, 0, cFr.stderr);
    assert.match(cFr.stdout, /Rencontre partagée entre les deux revues/);
    assert.ok(!/Gemeinsamer Austausch/.test(cFr.stdout), 'le texte allemand fuite dans la sortie française : ' + cFr.stdout);

    const cDe = convertir(de.article, null, BANC_RACINE);
    assert.strictEqual(cDe.status, 0, cDe.stderr);
    assert.match(cDe.stdout, /Gemeinsamer Austausch zwischen den Zeitschriften/);
    assert.ok(!/Rencontre partagée/.test(cDe.stdout), 'le texte français fuite dans la sortie allemande : ' + cDe.stdout);
  } finally {
    fr.nettoyer(); de.nettoyer();
  }
});

test('convertisseur : un fichier sous _Statuts n’est jamais lu comme une fiche', SAUT, () => {
  // _Statuts est un voisin de Fiches, jamais scruté : le confirmer en pointant --racine-news
  // sur le banc réel (qui porte les deux) et en vérifiant que le contenu du statut
  // (« a-traduire ») ne fuite nulle part dans un document qui n'a pourtant aucune raison de
  // le lire.
  const c = convertir(BANC);
  assert.strictEqual(c.status, 0, c.stderr);
  assert.ok(!/a-traduire/.test(c.stdout), 'le contenu d’un fichier de statut apparaît dans le markdown : ' + c.stdout);
});

test('racine _NewsUndActu : découverte automatique sous Revue\\<num> et sous _Archive\\Revue\\<num>, un cran plus bas', SAUT, () => {
  const racine = dossierJetable('szh-doc-racine-nommee-');
  try {
    const numeroEnCours = path.join(racine, 'Revue', '2026-02');
    const numeroArchive = path.join(racine, '_Archive', 'Revue', '2025-09');
    fs.mkdirSync(numeroEnCours, { recursive: true });
    fs.mkdirSync(numeroArchive, { recursive: true });
    fs.writeFileSync(path.join(numeroEnCours, 'ausgabe.yaml'), 'id: numeroencours0001\n');
    fs.writeFileSync(path.join(numeroArchive, 'ausgabe.yaml'), 'id: numeroarchive0002\n');
    for (const dossierNumero of [numeroEnCours, numeroArchive]) {
      const article = path.join(dossierNumero, 'articles', 'essai');
      fs.mkdirSync(article, { recursive: true });
      fs.writeFileSync(path.join(article, 'essai.meta.yaml'), 'type: documentation\nlang: fr\n');
      fs.writeFileSync(path.join(article, 'documentation.fr.txt'), 'Title: X\n');
      // Sans --racine-news ni SZH_NEWS_RACINE : la découverte par les noms de dossiers
      // doit suffire, dans les deux cas (numéro en cours et archivé).
      const c = convertir(article, null, null);
      assert.strictEqual(c.status, 0, `${dossierNumero} : ${c.stderr}`);
    }
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});
