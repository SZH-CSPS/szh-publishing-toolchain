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
const { python, sansPython } = require('./gardes');
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
function controle(base, { md, tables, fiche, instructions, word }) {
  const dossier = path.join(base, 'article');
  fs.mkdirSync(path.join(dossier, 'tables'), { recursive: true });
  fs.mkdirSync(path.join(dossier, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dossier, 'essai.md'), md, 'utf8');
  (tables || []).forEach((html, i) => fs.writeFileSync(
    path.join(dossier, 'tables', 'table-' + String(i + 1).padStart(2, '0') + '.html'), html, 'utf8'));
  fs.writeFileSync(path.join(dossier, 'essai.meta.yaml'), fiche || '', 'utf8');
  const meta = path.join(base, 'instructions.txt');
  fs.writeFileSync(meta, instructions || '', 'utf8');
  const r = python([CONTROLE, '--avant-medias', (word || wordDeuxTableaux)(base), 'essai', dossier,
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
      const r = python([CONTROLE, '--avant-medias', gabarit, 'essai', dossier,
        path.join(base, 'etat.json')], { encoding: 'utf8', env: Object.assign({}, F.ENV_UTF8, {
        SZH_META: meta, SZH_SLUG: 'essai' }) });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.ok(r.stderr.indexOf('tableau-texte-perdu') === -1, r.stderr);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

// Une image au milieu d'une cellule : le Word n'en porte pas le texte, tables/ en porte le src
// et l'alt. Ils ne doivent pas faire passer la cellule pour perdue.
function wordCelluleAvecImage(base) {
  return F.fabriquer(base, 'source', { corps: [
    p('Un titre pour l’essai', 'Heading1'),
    tableau([[[p('Anna Muster'), p('Beat Beispiel')]]]),
  ] });
}

for (const [nom, img] of [['src seul', '<img src="media/essai-fig-01.png" alt="">'],
  ['src et alt', '<img src="media/essai-fig-01.png" alt="Portrait de groupe">']]) {
  test('tableaux du Word : une image dans une cellule (' + nom + ') ne la fait pas passer pour perdue',
    { skip: sansPython }, () => {
      const base = F.dossierJetable();
      try {
        const html = '<table><tr><td>Anna Muster<br>' + img + '<br>Beat Beispiel</td></tr></table>';
        assert.deepStrictEqual(
          controle(base, { md: 'Un titre pour l’essai\n', tables: [html], word: wordCelluleAvecImage }), []);
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    });
}

test('tableaux du Word : la même cellule sans son texte est toujours signalée malgré l’image',
  { skip: sansPython }, () => {
    const base = F.dossierJetable();
    try {
      const html = '<table><tr><td>Anna Muster<br><img src="media/essai-fig-01.png" alt=""></td></tr></table>';
      const dits = controle(base, { md: 'Un titre pour l’essai\n', tables: [html], word: wordCelluleAvecImage });
      assert.strictEqual(dits.length, 1, dits.join('\n'));
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });


// ---- Tableaux consommés (T) : ce que la fiche ne porte pas est perdu, quoi que dise le corps.
const RESUME = 'Cette étude examine la collaboration entre les enseignantes et les enseignants '
  + 'spécialisés dans les classes ordinaires du canton.';
const CORPS_MEME_SUJET = 'Titre\n\nNous examinons ici la collaboration entre les enseignantes et les '
  + 'enseignants spécialisés dans les classes ordinaires du canton de Vaud, une étude menée en '
  + '2024.\n';

// Un Word dont le seul tableau est une suite de lignes « étiquette | valeur ».
function wordCellules(valeurs) {
  return (base) => F.fabriquer(base, 'source', { corps: [
    p('Titre', 'Heading1'),
    tableau(valeurs.map((v) => [[p(v[0], 'SZHCle')], [p(v[1])]])),
    p('Un paragraphe de corps assez long pour ne pas passer pour un titre de section.'),
  ] });
}
// Les avertissements du filet pour ce Word, le tableau 1 étant déclaré consommé.
function consomme(opts) {
  const base = F.dossierJetable();
  try { return controle(base, Object.assign({ instructions: 'T\t1\n' }, opts)); }
  finally { fs.rmSync(base, { recursive: true, force: true }); }
}

test('tableau consommé : un résumé absent de la fiche est signalé même si le corps parle du même sujet',
  { skip: sansPython }, () => {
    const dits = consomme({ md: CORPS_MEME_SUJET, fiche: 'title: "Titre"\n',
      word: wordCellules([['Résumé :', RESUME]]) });
    assert.strictEqual(dits.length, 1, dits.join('\n'));
  });

test('tableau consommé : une troisième autrice absente de la fiche est signalée',
  { skip: sansPython }, () => {
    const fiche = 'authors:\n- prenom: "Jeanne"\n  nom: "Exemple"\n- prenom: "Anna"\n  nom: "Muster"\n';
    const dits = consomme({ md: 'Titre\n\nCorps.\n', fiche, word: wordCellules([
      ['Prénom :', 'Jeanne'], ['Nom :', 'Exemple'], ['Prénom :', 'Anna'], ['Nom :', 'Muster'],
      ['Prénom :', 'Lucie'], ['Nom :', 'Perdue']]) });
    assert.strictEqual(dits.length, 1, dits.join('\n'));
    assert.match(dits[0], /Lucie/);
  });

// Le seuil : une cellule est perdue sous la moitié de ses mots connus de la fiche. Dix mots,
// quatre connus (perdue) puis cinq (sauve) : un seuil plus lâche ou plus strict fait rougir l'un.
const DIX_MOTS = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet';
for (const [connus, attendu] of [[4, 1], [5, 0]]) {
  test('tableau consommé : une cellule de dix mots dont ' + connus + ' sont dans la fiche '
    + (attendu ? 'est signalée' : 'passe'), { skip: sansPython }, () => {
    const fiche = 'resume: "' + DIX_MOTS.split(' ').slice(0, connus).join(' ') + '"\n';
    const dits = consomme({ md: 'Titre\n', fiche, word: wordCellules([['Résumé :', DIX_MOTS]]) });
    assert.strictEqual(dits.length, attendu, dits.join('\n'));
  });
}

test('tableau consommé : les mots du corps ne sauvent pas une cellule absente de la fiche',
  { skip: sansPython }, () => {
    const dits = consomme({ md: 'Titre\n\n' + DIX_MOTS + '\n', fiche: 'title: "Titre"\n',
      word: wordCellules([['Résumé :', DIX_MOTS]]) });
    assert.strictEqual(dits.length, 1, dits.join('\n'));
  });

// ---- Numérotation : celle de docx-tables.py, zones de texte comprises.
// Un tableau dans une zone de texte (mc:Choice et son doublon mc:Fallback) compte pour deux
// dans docx-tables.py : le tableau d'autrices est alors le 3e, pas le 1er. Le filet doit
// désigner le même tableau que les lignes T.
function wordZoneDeTexte(base) {
  const chemin = path.join(base, 'zone.docx');
  const code = [
    'import sys, zipfile',
    'W = ("xmlns:w=\\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\\" "',
    '     "xmlns:mc=\\"http://schemas.openxmlformats.org/markup-compatibility/2006\\" "',
    '     "xmlns:wp=\\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\\" "',
    '     "xmlns:a=\\"http://schemas.openxmlformats.org/drawingml/2006/main\\" "',
    '     "xmlns:wps=\\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\\"")',
    'tbl = lambda t: "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>%s</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" % t',
    'zone = ("<w:p><w:r><mc:AlternateContent><mc:Choice Requires=\\"wps\\"><w:drawing><wp:anchor><a:graphic>"',
    '        "<a:graphicData><wps:wsp><wps:txbx><w:txbxContent>%s<w:p/></w:txbxContent></wps:txbx></wps:wsp>"',
    '        "</a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict>"',
    '        "<w:txbxContent>%s<w:p/></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>")',
    'zone = zone % (tbl("dans la zone"), tbl("dans la zone"))',
    'doc = "<w:document %s><w:body>%s%s%s</w:body></w:document>" % (W, zone, tbl("Jeanne Exemple"), tbl("Donnees"))',
    'with zipfile.ZipFile(sys.argv[1], "w") as z:',
    '    z.writestr("word/document.xml", doc)'
  ].join('\n');
  const r = python(['-c', code, chemin], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return () => chemin;
}

test('tableaux du Word : après une zone de texte à tableau, T désigne le tableau de docx-tables.py',
  { skip: sansPython }, () => {
    const base = F.dossierJetable();
    try {
      const zone = '<table><tr><td>dans la zone</td></tr></table>';
      const donnees = '<table><tr><td>Donnees</td></tr></table>';
      // docx-tables.py compte : zone (1), son doublon (2), autrice (3), données (4).
      const dits = controle(base, { md: 'Titre\n', tables: [zone, zone, donnees],
        fiche: 'authors:\n- prenom: "Jeanne"\n  nom: "Exemple"\n', instructions: 'T\t3\n',
        word: wordZoneDeTexte(base) });
      assert.deepStrictEqual(dits, []);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
