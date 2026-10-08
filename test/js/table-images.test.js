// Images des cellules de tableau : le modèle (lib/table-model.js), l'aperçu et la copie
// (lib/table-images.js), la webview de l'éditeur (media/table-editor.js).
//
//   node --test "test/js/table-images.test.js"
//
// Cas type : le bloc de présentation d'une autrice, importé du Word avec son portrait dans
// une cellule (<img src="media/…" alt="" width="173">). L'image doit s'afficher dans
// l'éditeur et survivre à l'enregistrement. L'hôte et la copie dans media/ sont éprouvés
// dans table-images-hote.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ouvrir, chargerAvecVscodeFactice } = require('./dom-minimal');
const { sourceExtensionEtLib } = require('./hote-factice');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const table = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'table-model.js'));
const tableImages = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'table-images.js'));
const { T } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));

// Même forme que le fichier réel de l'import, sans ses données personnelles.
const BLOC_AUTEUR = '<table>\n<tr>\n<td><img src="media/portrait-fig-01.jpeg" alt="" width="173"></td>\n'
  + '<td></td>\n<td></td>\n</tr>\n<tr>\n<td>Dr Anne Exemple<br>Professeure<br>anne@exemple.ch </td>\n'
  + '<td></td>\n<td></td>\n</tr>\n</table>\n';

// ---- Modèle -------------------------------------------------------------------------

test('image de cellule : l’import Word traverse analyser/sérialiser sans perte', () => {
  const html = table.serialiserTable(table.analyserTable(BLOC_AUTEUR));
  assert.ok(html.indexOf('<td><img src="media/portrait-fig-01.jpeg" alt="" width="173"></td>') !== -1,
    'l’image a disparu du fichier réécrit : ' + html);
  // Rouvert et réenregistré sans changement : identique à l'octet.
  assert.strictEqual(table.serialiserTable(table.analyserTable(html)), html);
});

test('image de cellule : alt absent, alt vide et autres attributs restent ce qu’ils étaient', () => {
  const src = '<table><tr><td><img src="media/a.png"></td>'
    + '<td><img alt="Un &quot;chat&quot; &amp; co" src=\'media/b c.png\' class="x" data-k="1" height="40"/></td>'
    + '<td><img src="media/d.png" alt="" role="presentation"></td></tr></table>';
  const m = table.analyserTable(src);
  const [a, b, d] = m.lignes[0].cellules.map((c) => c.contenu);
  assert.strictEqual(a, '<img src="media/a.png">', 'un alt absent ne doit pas devenir alt=""');
  assert.strictEqual(b, '<img src="media/b c.png" alt="Un &quot;chat&quot; &amp; co" class="x" data-k="1" height="40">');
  assert.strictEqual(d, '<img src="media/d.png" alt="" role="presentation">');
  const relu = table.analyserTable(table.serialiserTable(m));
  assert.deepStrictEqual(relu.lignes[0].cellules.map((c) => c.contenu), [a, b, d]);
  // Le verdict de la pastille : absent et vide sans rôle sont signalés, le décoratif non.
  const verdicts = table.disposition(m).lignes[0].cellules.map((c) => c.images[0].sansAlternative);
  assert.deepStrictEqual(verdicts, [true, false, false]);
});

test('image de cellule : gestionnaires d’événements et javascript: ne passent pas', () => {
  const m = table.analyserTable('<table><tr><td><img src="javascript:alert(1)" onerror="x()" alt="a"></td></tr></table>');
  assert.strictEqual(m.lignes[0].cellules[0].contenu, '<img src="" alt="a">');
  // La légende, elle, n'admet pas d'image.
  assert.strictEqual(table.normaliserLegende('Titre <img src="media/a.png">'), 'Titre');
});

test('image de cellule : texte alternatif, décorative, remplacement et insertion', () => {
  let m = table.analyserTable(BLOC_AUTEUR);
  m = table.appliquerOperationTable('imageAlt', m, { li: 0, ci: 0, n: 0, decoratif: true });
  assert.strictEqual(m.lignes[0].cellules[0].contenu,
    '<img src="media/portrait-fig-01.jpeg" alt="" width="173" role="presentation">');
  m = table.appliquerOperationTable('imageAlt', m, { li: 0, ci: 0, n: 0, alt: 'Portrait d’Anne Exemple', decoratif: false });
  assert.strictEqual(m.lignes[0].cellules[0].contenu,
    '<img src="media/portrait-fig-01.jpeg" alt="Portrait d’Anne Exemple" width="173">', 'le rôle décoratif doit tomber');
  // Remplacer garde le texte alternatif et la largeur de mise en page.
  m = table.appliquerOperationTable('imageRemplacer', m, { li: 0, ci: 0, n: 0, src: 'media/nouveau.png' });
  assert.strictEqual(m.lignes[0].cellules[0].contenu,
    '<img src="media/nouveau.png" alt="Portrait d’Anne Exemple" width="173">');
  // Insérer : en fin de cellule, alt vide sans rôle — donc signalée jusqu'à la saisie.
  m = table.appliquerOperationTable('imageInserer', m, { li: 1, ci: 0, src: 'media/logo.png' });
  assert.strictEqual(m.lignes[1].cellules[0].contenu,
    'Dr Anne Exemple<br>Professeure<br>anne@exemple.ch<br><img src="media/logo.png" alt="">');
  m = table.appliquerOperationTable('imageInserer', m, { li: 0, ci: 1, src: 'media/vide.png' });
  assert.strictEqual(m.lignes[0].cellules[1].contenu, '<img src="media/vide.png" alt="">');
  assert.strictEqual(table.disposition(m).lignes[0].cellules[1].images[0].sansAlternative, true);
  // Un src refusé ne pose rien.
  const avant = JSON.stringify(m);
  m = table.appliquerOperationTable('imageInserer', m, { li: 0, ci: 2, src: 'javascript:x' });
  assert.strictEqual(JSON.stringify(m), avant);
});

test('image de cellule : copier une cellule puis la coller dans l’éditeur garde l’image', () => {
  let m = table.analyserTable('<table><tr><td>a</td></tr></table>');
  m = table.appliquerOperationTable('coller', m, { ancreR: 0, ancreC: 0,
    html: '<table><tr><td><img src="media/p.png" alt="P"></td></tr></table>', texte: '' });
  assert.strictEqual(m.lignes[0].cellules[0].contenu, '<img src="media/p.png" alt="P">');
  // Celle de Word pointe un fichier temporaire du poste : jetée.
  m = table.appliquerOperationTable('coller', m, { ancreR: 0, ancreC: 0,
    html: '<table><tr><td>t<img src="file:///C:/Temp/clip_image001.png"></td></tr></table>', texte: '' });
  assert.strictEqual(m.lignes[0].cellules[0].contenu, 't');
});

// ---- Aperçu et copie (lib/table-images.js) ----------------------------------------

function articleJetable() {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-table-images-'));
  fs.mkdirSync(path.join(dossier, 'media'));
  fs.mkdirSync(path.join(dossier, 'tables'));
  fs.writeFileSync(path.join(dossier, 'media', 'portrait-fig-01.jpeg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return dossier;
}

test('aperçus : le src est lu depuis le dossier de l’article, l’absence est dite', () => {
  const dossier = articleJetable();
  assert.strictEqual(tableImages.dossierArticleDeTable(path.join(dossier, 'tables', 'table-02.html')), dossier);
  const m = table.analyserTable(BLOC_AUTEUR.replace('<td></td>', '<td><img src="media/absente.png" alt="x"></td>')
    .replace('<td></td>', '<td><img src="http://exemple.ch/a.png" alt="x"></td>'));
  const ap = tableImages.apercusImagesTable(dossier, m);
  assert.strictEqual(ap['media/portrait-fig-01.jpeg'].etat, 'ok');
  assert.ok(/^data:image\/jpeg;base64,/.test(ap['media/portrait-fig-01.jpeg'].uri));
  assert.strictEqual(ap['media/absente.png'].etat, 'introuvable');
  assert.strictEqual(ap['http://exemple.ch/a.png'].etat, 'introuvable');
});

test('copie : nom libre dans media/, src relatif à l’article, conversion CMJN appelée', async () => {
  const dossier = articleJetable();
  const ailleurs = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-table-source-'));
  // Nom assaini (minuscules, sans espace : le Makefile coupe aux espaces), puis libre.
  const source = path.join(ailleurs, 'Portrait Fig 01.JPEG');
  fs.writeFileSync(path.join(dossier, 'media', 'portrait-fig-01.jpg'), 'pris');
  fs.writeFileSync(source, Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]));
  const convertis = [];
  const r = await tableImages.copierImageDansArticle(dossier, source, (ch) => { convertis.push(...ch); return Promise.resolve(0); });
  assert.strictEqual(r.src, 'media/portrait-fig-01-1.jpg', 'le nom pris doit recevoir un suffixe');
  assert.ok(fs.existsSync(path.join(dossier, 'media', 'portrait-fig-01-1.jpg')));
  assert.deepStrictEqual(convertis, [path.join(dossier, 'media', 'portrait-fig-01-1.jpg')]);
  // L'original n'est pas touché.
  assert.deepStrictEqual([...fs.readFileSync(path.join(dossier, 'media', 'portrait-fig-01.jpeg'))], [0xff, 0xd8, 0xff, 0xd9]);
  const texte = path.join(ailleurs, 'notes.txt');
  fs.writeFileSync(texte, 'x');
  await assert.rejects(() => tableImages.copierImageDansArticle(dossier, texte), (e) => e.code === 'format');
});

// ---- Webview ------------------------------------------------------------------------

// Les libellés de « charger », comme textesTable() les envoie : les clés table.* sans leur
// préfixe, et les clés img.* du gestionnaire des médias sous leur nom entier.
function libellesTable() {
  const src = sourceExtensionEtLib(COCKPIT);
  const i = src.indexOf('function textesTable');
  assert.notStrictEqual(i, -1, 'fonction de libellés introuvable : textesTable');
  const bloc = src.slice(i, src.indexOf('\n}', i));
  const txt = {};
  for (const m of bloc.matchAll(/'((?:table|img)\.[A-Za-z0-9_.]+)'/g)) {
    txt[m[1].indexOf('table.') === 0 ? m[1].slice('table.'.length) : m[1]] = T(m[1]);
  }
  return txt;
}

function pageAvecBloc(extra) {
  const page = ouvrir({
    racine: RACINE, page: 'table-editor', cssPartage: ['_design.css'], jsPartage: ['_messages.js']
  });
  const modele = table.analyserTable(BLOC_AUTEUR.replace('<td></td>', '<td><img src="media/absente.png" alt="Logo"></td>'));
  page.envoyer(Object.assign({ type: 'charger', modele: modele, disposition: table.disposition(modele),
    accent: '', teintes: {}, presets: [], i18n: libellesTable(),
    apercus: {
      'media/portrait-fig-01.jpeg': { etat: 'ok', uri: 'data:image/jpeg;base64,/9j/' },
      'media/absente.png': { etat: 'introuvable' }
    } }, extra || {}));
  return page;
}
const cellule = (page, r, c) => page.parId.zone.querySelectorAll('.cell')
  .find((e) => +e.dataset.r0 === r && +e.dataset.c0 === c);
const itemsMenu = (page) => page.document.body.querySelectorAll('.ctxitem');

test('webview : l’image s’affiche en vignette, l’absente en cadre explicite, la muette est signalée', () => {
  const page = pageAvecBloc();
  const vignettes = page.parId.zone.querySelectorAll('.cimg');
  assert.strictEqual(vignettes.length, 2, 'vignettes absentes de la grille');
  const img = vignettes[0].querySelector('img');
  assert.ok(img, 'l’aperçu n’est pas rendu');
  assert.strictEqual(img.src, 'data:image/jpeg;base64,/9j/');
  const cadre = vignettes[1].querySelector('.cimg-absente');
  assert.ok(cadre, 'une image introuvable doit se voir comme telle');
  assert.strictEqual(cadre.textContent, T('table.image.introuvable', ['media/absente.png']));
  // Pastille : le portrait (alt vide, pas décoratif) oui, le logo décrit non.
  assert.ok(vignettes[0].querySelector('.cimg-alerte'), 'pastille absente sur l’image sans texte alternatif');
  assert.strictEqual(vignettes[1].querySelector('.cimg-alerte'), null);
  // Enregistrer sans rien changer : la balise d'origine, pas l'aperçu.
  const enr = page.parId.barre.querySelectorAll('button').find((b) => b.textContent === T('table.enregistrer'));
  enr.dispatchEvent({ type: 'click' });
  const msg = page.messages.filter((m) => m.type === 'enregistrer').pop();
  assert.strictEqual(msg.modele.lignes[0].cellules[0].contenu,
    '<img src="media/portrait-fig-01.jpeg" alt="" width="173">');
});

test('webview : clic droit sur l’image -> texte alternatif, décorative, la pastille tombe', () => {
  const page = pageAvecBloc();
  const img = page.parId.zone.querySelectorAll('.cimg')[0].querySelector('img');
  img.dispatchEvent({ type: 'contextmenu', bubbles: true, clientX: 0, clientY: 0 });
  const libelles = itemsMenu(page).map((e) => e.textContent);
  assert.ok(libelles.indexOf(T('table.image.menuAlt')) !== -1, 'menu sans « Texte alternatif… » : ' + libelles.join(' | '));
  assert.ok(libelles.indexOf(T('table.image.menuRemplacer')) !== -1, 'menu sans « Remplacer l’image… »');
  assert.ok(libelles.indexOf(T('table.image.menuInserer')) === -1, 'sur une image, pas d’insertion');
  itemsMenu(page).find((e) => e.textContent === T('table.image.menuAlt')).dispatchEvent({ type: 'click' });
  const boite = page.document.body.querySelector('.saisie-alt');
  assert.ok(boite, 'la saisie du texte alternatif ne s’ouvre pas');
  // Vocabulaire du gestionnaire des médias.
  const txt = boite.textContent;
  for (const cle of ['img.role.titre', 'img.role.decrit', 'img.role.deco', 'img.alt']) {
    assert.ok(txt.indexOf(T(cle)) !== -1, 'libellé manquant dans la saisie : ' + cle);
  }
  const radios = boite.querySelectorAll('input[type="radio"]');
  radios[0].checked = false; radios[1].checked = true;
  radios[1].dispatchEvent({ type: 'change' });
  boite.querySelectorAll('button').find((b) => b.textContent === T('table.image.valider')).dispatchEvent({ type: 'click' });
  const op = page.messages.filter((m) => m.type === 'operation' && m.nom === 'imageAlt').pop();
  assert.ok(op, 'aucune opération imageAlt postée');
  assert.deepStrictEqual({ li: op.args.li, ci: op.args.ci, n: op.args.n, deco: op.args.decoratif }, { li: 0, ci: 0, n: 0, deco: true });
  assert.strictEqual(page.document.body.querySelector('.saisie-alt'), null, 'la saisie doit se refermer');
  const m = table.appliquerOperationTable('imageAlt', op.modele, op.args);
  page.envoyer({ type: 'charger', modele: m, disposition: table.disposition(m) });
  assert.strictEqual(page.parId.zone.querySelectorAll('.cimg-alerte').length, 0, 'la pastille ne tombe pas');
  assert.ok(page.parId.zone.querySelectorAll('.cimg')[0].querySelector('img'), 'l’aperçu est perdu au rechargement');
});

test('webview : « Insérer une image… » demande le fichier, puis ouvre la saisie', () => {
  const page = pageAvecBloc();
  cellule(page, 0, 2).dispatchEvent({ type: 'contextmenu', clientX: 0, clientY: 0 });
  const item = itemsMenu(page).find((e) => e.textContent === T('table.image.menuInserer'));
  assert.ok(item, 'menu d’une cellule sans « Insérer une image… »');
  item.dispatchEvent({ type: 'click' });
  const demande = page.messages.filter((m) => m.type === 'table-image-choisir').pop();
  assert.ok(demande, 'aucune demande de fichier à l’hôte');
  assert.deepStrictEqual({ a: demande.action, li: demande.li, ci: demande.ci }, { a: 'inserer', li: 0, ci: 2 });
  // L'hôte répond : l'opération part de la page (historique), puis la saisie s'ouvre.
  page.envoyer({ type: 'table-image-choisie', action: 'inserer', li: 0, ci: 2, n: 0, src: 'media/neuve.png',
    apercu: { etat: 'ok', uri: 'data:image/png;base64,iVBO' } });
  const op = page.messages.filter((m) => m.type === 'operation' && m.nom === 'imageInserer').pop();
  assert.ok(op, 'aucune opération imageInserer postée');
  assert.strictEqual(op.args.src, 'media/neuve.png');
  const m = table.appliquerOperationTable('imageInserer', op.modele, op.args);
  page.envoyer({ type: 'charger', modele: m, disposition: table.disposition(m) });
  const neuve = cellule(page, 0, 2).querySelector('.cimg');
  assert.ok(neuve && neuve.querySelector('img') && neuve.querySelector('img').src === 'data:image/png;base64,iVBO',
    'l’image insérée ne s’affiche pas');
  assert.ok(neuve.querySelector('.cimg-alerte'), 'l’image insérée, sans texte alternatif, doit être signalée');
  assert.ok(page.document.body.querySelector('.saisie-alt'), 'la saisie du texte alternatif ne s’ouvre pas d’office');
});

test('webview : focusImage sélectionne la cellule de l’image et ouvre sa saisie', () => {
  const page = pageAvecBloc({ focusImage: 'portrait-fig-01.jpeg' });
  const cell = cellule(page, 0, 0);
  assert.ok(cell.classes.has('sel'), 'la cellule de l’image n’est pas sélectionnée');
  assert.ok(cell._scrolled, 'la cellule n’est pas amenée à l’écran');
  assert.ok(page.document.body.querySelector('.saisie-alt'), 'image sans texte alternatif : la saisie doit s’ouvrir');
  // Une image décrite : sélection seulement, pas de saisie.
  const page2 = pageAvecBloc({ focusImage: 'ABSENTE.png' });
  assert.ok(cellule(page2, 0, 1).classes.has('sel'));
  assert.strictEqual(page2.document.body.querySelector('.saisie-alt'), null);
  // Sur un éditeur déjà ouvert, le même geste arrive par FOCALISER.
  page2.envoyer({ type: 'focaliser', focusImage: 'portrait-fig-01.jpeg' });
  assert.ok(cellule(page2, 0, 0).classes.has('sel'));
  assert.ok(page2.document.body.querySelector('.saisie-alt'));
});
