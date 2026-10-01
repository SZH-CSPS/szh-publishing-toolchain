// Le filet de sécurité de l'import regarde aussi le TEXTE des tableaux du Word.
//
//   node --test test/js/import-controle-tableaux.test.js
//
// Avant : pipeline/docx-controle-import.py ne contrôlait que les images et les valeurs de
// bloc. Un tableau de données perdu par la chaîne (cas d'un tableau placé dans un contrôle de
// contenu Word, que le lecteur a pris pour un tableau d'auteurs) disparaissait sans un mot.
// Maintenant chaque tableau de premier niveau du Word doit se retrouver dans l'article
// (.md ou tables/*.html) ; un tableau que le lecteur a consommé (ligne T) se retrouve, mot à
// mot, dans la fiche ou les instructions. Sinon : l'avertissement tableau-texte-perdu.
//
// Le contrôle seul, sur un article fabriqué à la main (sans WSL ni pandoc).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython } = require('./gardes');
const F = require('./figures-fabrique');

const CONTROLE = path.join(F.RACINE, 'pipeline', 'docx-controle-import.py');
const p = (texte, style) => ({ p: [{ t: texte }], style: style });
const tableau = (rangees) => ({ tbl: rangees });

// Un Word à deux tableaux : des données, puis une fiche d'autrice (une cellule, deux
// paragraphes).
function wordDeuxTableaux(base) {
  return F.fabriquer(base, 'source', { corps: [
    p('Un titre pour l’essai', 'Heading1'),
    p('Un paragraphe de corps assez long pour ne pas passer pour un titre de section.'),
    tableau([[[p('Année')], [p('Effectif')]], [[p('2023')], [p('Quatre cent trente')]]]),
    p('Un autre paragraphe de corps, lui aussi assez long pour rester du corps de texte.'),
    tableau([[[p('Jeanne Exemple'), p('Haute école de test')]]]),
  ] });
}

// Un article « déjà converti » : le .md, tables/ et la fiche, au choix. Rend les avertissements
// `tableau-texte-perdu` de la passe 1.
function controle(base, { md, tables, fiche, instructions }) {
  const dossier = path.join(base, 'article');
  fs.mkdirSync(path.join(dossier, 'tables'), { recursive: true });
  fs.mkdirSync(path.join(dossier, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dossier, 'essai.md'), md, 'utf8');
  (tables || []).forEach((html, i) => fs.writeFileSync(
    path.join(dossier, 'tables', 'table-' + String(i + 1).padStart(2, '0') + '.html'), html, 'utf8'));
  fs.writeFileSync(path.join(dossier, 'essai.meta.yaml'), fiche || '', 'utf8');
  const meta = path.join(base, 'instructions.txt');
  fs.writeFileSync(meta, instructions || '', 'utf8');
  const r = cp.spawnSync(PYTHON, [CONTROLE, '--avant-medias', wordDeuxTableaux(base), 'essai', dossier,
    path.join(base, 'etat.json')], { encoding: 'utf8', env: Object.assign({}, F.ENV_UTF8, {
    SZH_META: meta, SZH_SLUG: 'essai' }) });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stderr.split(/\r?\n/).filter((l) => l.indexOf('tableau-texte-perdu') !== -1);
}

const MD = 'Un titre pour l’essai\n\nUn paragraphe de corps assez long pour ne pas passer pour un '
  + 'titre de section.\n\n::: {.szh-tabelle src="tables/table-01.html"}\n:::\n\nUn autre paragraphe.\n';
const HTML_DONNEES = '<table><tr><th>Année</th><th>Effectif</th></tr>'
  + '<tr><td>2023</td><td>Quatre cent trente</td></tr></table>';
const HTML_AUTRICE = '<table><tr><td><p>Jeanne Exemple</p><p>Haute école de test</p></td></tr></table>';

test('tableaux du Word : tous retrouvés dans le .md et tables/, aucun avertissement',
  { skip: sansPython }, () => {
    const base = F.dossierJetable();
    try {
      assert.deepStrictEqual(controle(base, { md: MD, tables: [HTML_DONNEES, HTML_AUTRICE] }), []);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

test('tableaux du Word : un tableau de données absent de l’article est nommé, fr puis de',
  { skip: sansPython }, () => {
    const base = F.dossierJetable();
    try {
      const dits = controle(base, { md: MD, tables: [HTML_AUTRICE] });
      assert.strictEqual(dits.length, 1, dits.join('\n'));
      assert.match(dits[0], /^\[import-avertissement\] tableau-texte-perdu \| article « essai » \| tableau 1 du Word \| cellules « Année ; Effectif ; 2023/);
      assert.match(dits[0], /ne se retrouve nulle part dans l’article.*\[de\] Der Text der Tabelle 1/);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

test('tableaux du Word : un tableau consommé (T) se retrouve mot à mot dans la fiche',
  { skip: sansPython }, () => {
    const base = F.dossierJetable();
    try {
      // Le lecteur a consommé le tableau 2 (l'autrice) : elle est dans la fiche, champ par champ.
      const fiche = 'authors:\n- prenom: "Jeanne"\n  nom: "Exemple"\n  affiliation: "Haute école de test"\n';
      assert.deepStrictEqual(controle(base, { md: MD, tables: [HTML_DONNEES], fiche, instructions: 'T\t2\n' }), []);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

test('tableaux du Word : un tableau déclaré consommé (T) dont le texte n’est nulle part est signalé',
  { skip: sansPython }, () => {
    const base = F.dossierJetable();
    try {
      // Le lecteur a consommé le tableau 1 — mais c'est le tableau de données, pas l'autrice :
      // rien de ce qu'il porte n'est dans la fiche. Le numéro T ne suffit pas à l'absoudre.
      const fiche = 'authors:\n- prenom: "Jeanne"\n  nom: "Exemple"\n  affiliation: "Haute école de test"\n';
      const dits = controle(base, { md: MD, tables: [HTML_AUTRICE], fiche, instructions: 'T\t1\n' });
      assert.strictEqual(dits.length, 1, dits.join('\n'));
      assert.match(dits[0], /tableau 1 du Word/);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

test('tableaux du Word : les étiquettes « SZH Cle » d’un tableau consommé ne comptent pas',
  { skip: sansPython }, () => {
    const base = F.dossierJetable();
    try {
      const gabarit = F.fabriquer(base, 'gabarit', { corps: [
        p('Un titre pour l’essai', 'Heading1'),
        tableau([[[p('Mots-clés :', 'SZHCle')], [p('')]], [[p('Résumé :', 'SZHCle')], [p('')]]]),
      ] });
      const dossier = path.join(base, 'article');
      fs.mkdirSync(dossier, { recursive: true });
      fs.writeFileSync(path.join(dossier, 'essai.md'), 'Un titre pour l’essai\n', 'utf8');
      const meta = path.join(base, 'instructions.txt');
      fs.writeFileSync(meta, 'T\t1\n', 'utf8');
      const r = cp.spawnSync(PYTHON, [CONTROLE, '--avant-medias', gabarit, 'essai', dossier,
        path.join(base, 'etat.json')], { encoding: 'utf8', env: Object.assign({}, F.ENV_UTF8, {
        SZH_META: meta, SZH_SLUG: 'essai' }) });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.ok(r.stderr.indexOf('tableau-texte-perdu') === -1, r.stderr);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
