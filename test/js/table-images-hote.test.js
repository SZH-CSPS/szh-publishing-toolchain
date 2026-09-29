// Images des cellules de tableau, côté hôte réellement activé : l'éditeur s'ouvre avec les
// aperçus, « Insérer une image… » et « Remplacer l'image… » copient le fichier choisi dans
// media/ de l'article et écrivent le bon src dans tables/table-NN.html.
//
//   node --test "test/js/table-images-hote.test.js"
//
// Un processus à lui : le crochet de Module._load posé par activerHote ne se défait pas.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const ARTICLE = path.join(REVUE, 'articles', '01-essai');
const TABLE = path.join(ARTICLE, 'tables', 'table-02.html');

async function ouvrirEditeur(extra) {
  await HOTE.executer('szh.editerTable', Object.assign({ slug: '01-essai', cheminAsset: TABLE }, extra || {}));
  const p = HOTE.panneauDeType('szhEditeurTable');
  assert.ok(p, 'éditeur de tableau non ouvert');
  await p._recepteur({ type: 'pret' });
  const charge = p.messages.filter((m) => m.type === 'charger').pop();
  assert.ok(charge, 'aucun « charger »');
  return { p, charge };
}

// La réponse du sélecteur de fichier : une image hors de l'article, de même nom que celle
// qui y est déjà — la copie doit prendre un nom libre, jamais écraser.
function imageSource(nom) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-table-hote-'));
  const f = path.join(d, nom);
  fs.writeFileSync(f, Buffer.alloc(80, 7));
  return f;
}

test('hôte : l’éditeur reçoit l’aperçu des images de cellule et le focus demandé', async () => {
  fs.writeFileSync(TABLE, '<table>\n<tr>\n<td><img src="media/a.png" alt="" width="173"></td>\n<td></td>\n</tr>\n'
    + '<tr>\n<td><img src="media/perdue.png" alt="x"></td>\n<td>t</td>\n</tr>\n</table>\n');
  const { p, charge } = await ouvrirEditeur({ focusImage: 'a.png' });
  assert.ok(/^img-src data:|; img-src data:;/.test(p.html.match(/Content-Security-Policy" content="([^"]*)"/)[1]),
    'la CSP de l’éditeur doit admettre les aperçus en data:');
  assert.strictEqual(charge.apercus['media/a.png'].etat, 'ok');
  assert.ok(/^data:image\/png;base64,/.test(charge.apercus['media/a.png'].uri));
  assert.strictEqual(charge.apercus['media/perdue.png'].etat, 'introuvable');
  assert.strictEqual(charge.focusImage, 'a.png');
  assert.strictEqual(charge.disposition.lignes[0].cellules[0].images[0].sansAlternative, true);
  p.dispose();
});

test('hôte : insérer puis remplacer copient dans media/ et écrivent le bon src', async () => {
  fs.writeFileSync(TABLE, '<table>\n<tr>\n<td><img src="media/a.png" alt="Portrait" width="173"></td>\n<td></td>\n</tr>\n</table>\n');
  const { p } = await ouvrirEditeur();
  const charge0 = p.messages.filter((m) => m.type === 'charger').pop();

  // Insérer dans la cellule vide (0, 1).
  HOTE.repondreOuverture([{ fsPath: imageSource('a.png') }]);
  await p._recepteur({ type: 'table-image-choisir', action: 'inserer', li: 0, ci: 1, n: 0 });
  let rep = p.messages.filter((m) => m.type === 'table-image-choisie').pop();
  assert.ok(rep, 'aucune réponse de l’hôte au choix d’image');
  assert.strictEqual(rep.src, 'media/a-1.png', 'le nom déjà pris doit recevoir un suffixe');
  assert.ok(fs.existsSync(path.join(ARTICLE, 'media', 'a-1.png')), 'l’image n’est pas copiée dans media/');
  assert.strictEqual(rep.apercu.etat, 'ok');
  // La page rejoue l'opération, puis enregistre.
  await p._recepteur({ type: 'operation', nom: 'imageInserer', modele: charge0.modele,
    args: { li: rep.li, ci: rep.ci, src: rep.src } });
  let m = p.messages.filter((x) => x.type === 'charger').pop().modele;
  await p._recepteur({ type: 'enregistrer', modele: m });
  let disque = fs.readFileSync(TABLE, 'utf8');
  assert.ok(disque.indexOf('<td><img src="media/a-1.png" alt=""></td>') !== -1, 'src inséré absent du fichier : ' + disque);
  assert.ok(disque.indexOf('<img src="media/a.png" alt="Portrait" width="173">') !== -1, 'l’image voisine a bougé');

  // Remplacer la première image : src neuf, alt et largeur gardés.
  HOTE.repondreOuverture([{ fsPath: imageSource('nouveau portrait.png') }]);
  await p._recepteur({ type: 'table-image-choisir', action: 'remplacer', li: 0, ci: 0, n: 0 });
  rep = p.messages.filter((x) => x.type === 'table-image-choisie').pop();
  assert.strictEqual(rep.action, 'remplacer');
  assert.strictEqual(rep.src, 'media/nouveau-portrait.png', 'nom sans espace : le Makefile coupe aux espaces');
  await p._recepteur({ type: 'operation', nom: 'imageRemplacer', modele: m,
    args: { li: 0, ci: 0, n: 0, src: rep.src } });
  m = p.messages.filter((x) => x.type === 'charger').pop().modele;
  await p._recepteur({ type: 'enregistrer', modele: m });
  disque = fs.readFileSync(TABLE, 'utf8');
  assert.ok(disque.indexOf('<img src="media/nouveau-portrait.png" alt="Portrait" width="173">') !== -1,
    'remplacement mal écrit : ' + disque);
  // L'ancien fichier reste (il peut servir ailleurs dans l'article).
  assert.ok(fs.existsSync(path.join(ARTICLE, 'media', 'a.png')));

  // Dialogue annulé : aucune réponse, rien de copié.
  const avant = p.messages.length;
  HOTE.repondreOuverture(undefined);
  await p._recepteur({ type: 'table-image-choisir', action: 'inserer', li: 0, ci: 1, n: 0 });
  assert.strictEqual(p.messages.length, avant);
  p.dispose();
});
