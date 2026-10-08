// lib/reperage-focus.js : retrouver dans un .md le passage qu'un constat désigne par son
// `focus`, malgré la normalisation que pipeline/filters/szh-citations.lua lui a fait subir
// avant de l'écrire (espaces insécables/fines, tirets longs, espaces multiples).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { trouverPlageFocus } = require(path.join(COCKPIT, 'lib', 'reperage-focus.js'));

// Relit la plage trouvée pour comparer une chaîne, pas des offsets — plus lisible à l'échec.
function extrait(texte, focus) {
  const plage = trouverPlageFocus(texte, focus);
  return plage ? texte.slice(plage.debut, plage.fin) : null;
}

test('trouverPlageFocus : appel présent tel quel', () => {
  const doc = 'Comme le montre (Shaw et al., 2023), le constat est clair.';
  assert.strictEqual(extrait(doc, '(Shaw et al., 2023)'), '(Shaw et al., 2023)');
});

test('trouverPlageFocus : espace insécable dans le .md, espace simple dans le focus', () => {
  // L'espace insécable est entre « al., » et « 2023) », comme le laissent Word et pandoc.
  const doc = 'Comme le montre (Shaw et al., 2023), le constat est clair.';
  assert.strictEqual(extrait(doc, '(Shaw et al., 2023)'), '(Shaw et al., 2023)');
});

test('trouverPlageFocus : tiret demi-cadratin dans le .md, trait d’union dans le focus', () => {
  const doc = 'Voir la page 12–14 pour le détail.';
  assert.strictEqual(extrait(doc, '12-14'), '12–14');
});

test('trouverPlageFocus : tiret cadratin et trait d’union insécable, même règle', () => {
  assert.strictEqual(extrait('Un tiret — cadratin ici.', 'tiret - cadratin'), 'tiret — cadratin');
  assert.strictEqual(extrait('Un trait‑d’union insécable.', 'trait-d’union'), 'trait‑d’union');
});

test('trouverPlageFocus : espaces multiples dans le .md, un seul dans le focus', () => {
  const doc = 'Comme le montre (Shaw   et al.,  2023), le constat est clair.';
  assert.strictEqual(extrait(doc, '(Shaw et al., 2023)'), '(Shaw   et al.,  2023)');
});

test('trouverPlageFocus : appel absent — rien, jamais une erreur', () => {
  const doc = 'Ce texte ne cite personne.';
  assert.strictEqual(trouverPlageFocus(doc, '(Shaw et al., 2023)'), null);
});

test('trouverPlageFocus : deux occurrences — la première gagne', () => {
  const doc = 'Premier renvoi (Shaw et al., 2023) puis un second (Shaw et al., 2023) plus loin.';
  const plage = trouverPlageFocus(doc, '(Shaw et al., 2023)');
  assert.strictEqual(plage.debut, doc.indexOf('(Shaw et al., 2023)'));
  assert.notStrictEqual(plage.debut, doc.lastIndexOf('(Shaw et al., 2023)'));
});

test('trouverPlageFocus : focus vide ou document vide — rien', () => {
  assert.strictEqual(trouverPlageFocus('un texte quelconque', ''), null);
  assert.strictEqual(trouverPlageFocus('', '(Shaw et al., 2023)'), null);
  assert.strictEqual(trouverPlageFocus('', ''), null);
});

// ---- Passages que la normalisation du filtre rend difficiles à retrouver ----

test('trouverPlageFocus : une référence en italique dans le .md, aplatie dans le constat', () => {
  // utils.stringify() retire l'emphase : le constat dit « Soi-même comme un autre », le
  // .md écrit « *Soi-même comme un autre* ». La sélection couvre le texte réel, astérisques
  // intérieurs compris.
  const doc = 'Ricœur, P. (1990). *Soi-même comme un autre*. Seuil.\n';
  assert.strictEqual(extrait(doc, 'Ricœur, P. (1990). Soi-même comme un autre. Seuil.'),
    'Ricœur, P. (1990). *Soi-même comme un autre*. Seuil.');
});

test('trouverPlageFocus : l’ellipse et la lettre coupée en deux d’une troncature ne cassent rien', () => {
  const doc = 'Ricœur, P. (1990). Soi-même comme un autre. Seuil.';
  assert.strictEqual(extrait(doc, 'Ricœur, P. (1990). Soi-même comme un autre. Seuil.…'), doc);
  // sub(1, 70) du filtre compte des octets : la dernière lettre accentuée devient U+FFFD.
  assert.strictEqual(extrait(doc, 'Ricœur, P. (1990). Soi-m�'), 'Ricœur, P. (1990). Soi-m');
});

test('trouverPlageFocus : un lien aplati — le début suffit, jamais moins de trente caractères', () => {
  const doc = 'Shaw, A. (2023). Titre de l’étude complète. [https://doi.org/10.1/x](https://doi.org/10.1/x)';
  const plage = trouverPlageFocus(doc, 'Shaw, A. (2023). Titre de l’étude complète. https://doi.org/10.1/x');
  assert.ok(plage, 'la référence au DOI en lien n’est pas retrouvée');
  assert.strictEqual(plage.debut, 0);
  // Un focus court ne se rabat pas sur un préfixe : « (Sen, 2001) » absent reste absent.
  assert.strictEqual(trouverPlageFocus('Selon (Sen, 2002), rien.', '(Sen, 2001)'), null);
});

test('focusDeRepli : les constats qui ne citent aucun mot désignent quand même un endroit', () => {
  const { focusDeRepli, premierTitreDeNiveau, titreBibliographie } =
    require(path.join(COCKPIT, 'lib', 'reperage-focus.js'));
  const md = ['# Einleitung', '', '###### Trop profond', '', '::: {.szh-biblio src="a.biblio.md"}',
    ':::', '', 'Reste.', '', '::: {.szh-tabelle src="tables/table-02.html"}', ':::', '',
    '# Literatur', ''].join('\n');
  const tables = [{ nom: 'table-01.html', html: '<table><tr><td>1</td></tr></table>' },
    { nom: 'table-02.html', html: '<table><tr><td>b.massie@hfh.ch</td></tr></table>' }];
  assert.strictEqual(focusDeRepli('rendu/niveaux-ecrases', ['6, 7'], md, tables), '###### Trop profond');
  assert.strictEqual(focusDeRepli('import/biblio-incomplete', [], md, tables), '{.szh-biblio');
  assert.strictEqual(focusDeRepli('import/biblio-non-detachee', [], md, tables), '# Literatur');
  assert.strictEqual(focusDeRepli('import/tableau-auteurs-non-lu', [], md, tables), 'tables/table-02.html');
  assert.strictEqual(focusDeRepli('citations/bilan', [], md, tables), '');
  // Chaque repli est un extrait que trouverPlageFocus sait sélectionner.
  for (const f of ['###### Trop profond', '{.szh-biblio', '# Literatur', 'tables/table-02.html']) {
    assert.strictEqual(extrait(md, f), f);
  }
  // Un niveau exact : « ## » ne désigne pas « ### ».
  assert.strictEqual(premierTitreDeNiveau('### A\n## B\n', 2), '## B');
  // Un titre de bibliographie se reconnaît entier, jamais par son début.
  assert.strictEqual(titreBibliographie('## Literaturhinweise für die Praxis\n'), '');
});

test('focusDeRepli : la règle PDF/UA 7.4.2-1 vise le premier titre qui saute un niveau', () => {
  const { focusDeRepli } = require(path.join(COCKPIT, 'lib', 'reperage-focus.js'));
  const saut = { repere: '7.4.2-1' };
  // « ### » juste après « # », alors que « ## » existe : le PDF sort h2 puis h4.
  const md = ['# Introduction', '', 'Texte.', '', '### Méthode', '', '## Résultats', '',
    '```', '# pas un titre', '```'].join('\n');
  assert.strictEqual(focusDeRepli('pdfua/regle', [], md, [], saut), '### Méthode');
  assert.strictEqual(extrait(md, '### Méthode'), '### Méthode');
  // Des niveaux qui ne se suivent pas mais sans trou dans l'ordre : la chaîne les compacte
  // (szh-niveaux.lua), le PDF ne saute rien et l'article s'ouvre en haut, comme avant.
  assert.strictEqual(focusDeRepli('pdfua/regle', [], '## A\n\n#### B\n\n## C\n', [], saut), '');
  // Le titre en tête de corps qui n'est pas du premier rang saute lui aussi.
  assert.strictEqual(focusDeRepli('pdfua/regle', [], '### Avant\n\n# Puis\n\n## Fin\n', [], saut), '### Avant');
  // Une autre règle PDF/UA ne se repère pas ainsi.
  assert.strictEqual(focusDeRepli('pdfua/regle', [], md, [], { repere: '7.1-9' }), '');
  assert.strictEqual(focusDeRepli('pdfua/regle', [], md, []), '');
});

test('trouverPlageFocus : combinaison insécable + tiret + espaces multiples', () => {
  const doc = 'Renvoi  (Shaw et al., 2023, –p. 12) ici.';
  const plage = trouverPlageFocus(doc, '(Shaw et al., 2023, -p. 12)');
  assert.notStrictEqual(plage, null);
  assert.strictEqual(doc.slice(plage.debut, plage.fin), '(Shaw et al., 2023, –p. 12)');
});
