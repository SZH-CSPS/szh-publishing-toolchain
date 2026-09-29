// Les formulaires « Médias de l'article » et l'éditeur de tableaux relancent la compilation
// de l'article qu'ils viennent d'enregistrer — comme les métadonnées
// (focus-recompilation.test.js, A3) — sur l'hôte réellement activé : UNE compilation, du bon
// article, seulement quand quelque chose a changé, après l'anti-rebond (raccourci ici à
// 40 ms), à la fermeture du panneau si elle attendait encore, et jamais sur un numéro gelé.
// La mécanique de l'anti-rebond elle-même est éprouvée à froid (relance-compilation.test.js).
//
//   node --test "test/js/relance-formulaires-hote.test.js"
//
// Un processus à lui : activerHote() n'admet qu'un appel par processus.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote, demarrageSeTait } = require('./hote-factice');

const NOM_BUILD = 'Aperçu / Export PDF';
const DELAI = 40;
const tick = () => new Promise((r) => setImmediate(r));
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const ext = require(path.join(COCKPIT, 'extension.js'));
// Même instance que celle d'extension.js (cache de require) : le délai se règle ici.
const relance = require(path.join(COCKPIT, 'lib', 'relance-compilation.js'));
const session = require(path.join(COCKPIT, 'lib', 'session.js'));
const ARTICLE = path.join(REVUE, 'articles', '01-essai');
const TABLE = path.join(ARTICLE, 'tables', 'table-02.html');

HOTE.arbre().definirRacine(REVUE);
relance.poserDelai(DELAI);

// Les compilations lancées par le cockpit : fetchTasks lui fait trouver la tâche de build,
// executeTask compte. `slugs()` : les articles que la barre d'état a annoncés depuis.
function compteur() {
  const origExecute = HOTE.stub.tasks.executeTask;
  const statutsAvant = HOTE.statuts.length;
  const c = { appels: 0 };
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_BUILD }]);
  HOTE.stub.tasks.executeTask = (t) => { c.appels++; return origExecute(t); };
  c.statuts = () => HOTE.statuts.slice(statutsAvant);
  c.finir = async () => { await HOTE.finirTache(NOM_BUILD, 0); await tick(); await tick(); };
  c.restaurer = () => {
    HOTE.stub.tasks.executeTask = origExecute;
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  };
  return c;
}

// Assez pour l'anti-rebond, puis les micro-tâches de lancerTache (fetchTasks, executeTask).
async function apresDelai() { await attendre(DELAI * 3); for (let i = 0; i < 5; i++) { await tick(); } }

async function panneauMedias() {
  await HOTE.executer('szh.mediasArticle', { slug: '01-essai' });
  const p = HOTE.panneauDeType('szhMedias');
  assert.ok(p && p._recepteur, 'le formulaire des médias ne s’est pas ouvert');
  return p;
}

const TABLE_HTML = (texte) => '<table>\n<tr>\n<td>' + texte + '</td>\n<td>b</td>\n</tr>\n</table>\n';

async function panneauTable() {
  await HOTE.executer('szh.editerTable', { slug: '01-essai', cheminAsset: TABLE });
  const p = HOTE.panneauDeType('szhEditeurTable');
  assert.ok(p && p._recepteur, 'l’éditeur de tableau ne s’est pas ouvert');
  await p._recepteur({ type: 'pret' });
  return p;
}

// Le modèle que la webview enverrait pour ce contenu de cellule.
const modele = (texte) => ext._pur.analyserTable(TABLE_HTML(texte));

test('mise en route : le démarrage se tait', async () => {
  await demarrageSeTait(HOTE);
});

// ---- Médias de l'article -------------------------------------------------------------

test('Médias : un enregistrement qui change la légende relance UNE compilation, de cet article',
  async () => {
    const p = await panneauMedias();
    const c = compteur();
    try {
      await p._recepteur({ type: 'enregistrer', auto: false, medias: [
        { relatif: 'a.png', valeurs: { legende: 'Nouvelle legende', alt: 'desc', altDefini: true } }
      ] });
      await tick();
      assert.strictEqual(c.appels, 0, 'la compilation est partie sans attendre l’anti-rebond');
      await apresDelai();
      assert.strictEqual(c.appels, 1, 'l’enregistrement des médias n’a pas relancé la compilation');
      assert.ok(c.statuts().some((m) => m.indexOf('01-essai') !== -1),
        'la barre d’état n’annonce pas la compilation de 01-essai : ' + JSON.stringify(c.statuts()));
      assert.ok(!HOTE.panneauDeType('szhApercuHtml'), 'la compilation a rouvert un aperçu');
      await c.finir();
      await apresDelai();
      assert.strictEqual(c.appels, 1, 'une seconde compilation est partie');
    } finally { c.restaurer(); }
  });

test('Médias : un enregistrement sans changement ne compile rien', async () => {
  const p = await panneauMedias();
  const c = compteur();
  try {
    // Les valeurs mêmes du .md de la revue d'essai : « ![Une legende](media/a.png){alt="desc"} ».
    await p._recepteur({ type: 'enregistrer', auto: true, medias: [
      { relatif: 'a.png', valeurs: { legende: 'Une legende', alt: 'desc', altDefini: true } }
    ] });
    await apresDelai();
    assert.strictEqual(c.appels, 0, 'un enregistrement à l’identique a relancé la compilation');
    assert.ok(p.messages.some((m) => m.type === 'enregistre'), 'l’enregistrement n’a pas été accusé');
  } finally { c.restaurer(); }
});

// ---- Éditeur de tableaux -------------------------------------------------------------

test('Tableau : trois enregistrements rapprochés → une seule compilation, après le délai',
  async () => {
    fs.writeFileSync(TABLE, TABLE_HTML('a'));
    const p = await panneauTable();
    const c = compteur();
    try {
      for (const texte of ['un', 'deux', 'trois']) {
        await p._recepteur({ type: 'enregistrer', auto: true, modele: modele(texte) });
        await attendre(DELAI / 4);
      }
      assert.ok(fs.readFileSync(TABLE, 'utf8').indexOf('trois') !== -1, 'le tableau n’a pas été écrit');
      assert.strictEqual(c.appels, 0, 'une compilation est partie pendant l’anti-rebond');
      await apresDelai();
      assert.strictEqual(c.appels, 1,
        'trois enregistrements rapprochés doivent donner UNE compilation, pas ' + c.appels);
      assert.ok(c.statuts().some((m) => m.indexOf('01-essai') !== -1),
        'la compilation n’annonce pas 01-essai : ' + JSON.stringify(c.statuts()));
      await c.finir();

      // Le même tableau renvoyé tel quel (sortie de champ) : rien à recompiler.
      await p._recepteur({ type: 'enregistrer', auto: true, modele: modele('trois') });
      await apresDelai();
      assert.strictEqual(c.appels, 1, 'un tableau écrit à l’identique a relancé la compilation');
    } finally { c.restaurer(); p.dispose(); }
  });

test('Tableau : fermer le panneau fait partir tout de suite la compilation en attente',
  async () => {
    fs.writeFileSync(TABLE, TABLE_HTML('a'));
    relance.poserDelai(60000);            // l'anti-rebond ne peut pas échoir pendant le test
    const p = await panneauTable();
    const c = compteur();
    try {
      await p._recepteur({ type: 'enregistrer', auto: true, modele: modele('fermeture') });
      for (let i = 0; i < 5; i++) { await tick(); }
      assert.strictEqual(c.appels, 0);
      p.dispose();
      for (let i = 0; i < 5; i++) { await tick(); }
      assert.strictEqual(c.appels, 1, 'la fermeture n’a pas fait partir la compilation en attente');
      await c.finir();
    } finally { c.restaurer(); relance.poserDelai(DELAI); }
  });

// ---- Numéro gelé ---------------------------------------------------------------------

test('Numéro verrouillé (compilation automatique coupée) : ni Médias ni Tableau ne compilent',
  async () => {
    fs.writeFileSync(TABLE, TABLE_HTML('a'));
    // Les panneaux s'ouvrent avant le verrou (cmdEcriture le refuserait) : un panneau resté
    // ouvert survit au verrouillage, c'est justement le cas à couvrir.
    const medias = await panneauMedias();
    const table = await panneauTable();
    const etatAvant = session.etatNumero();
    const c = compteur();
    session.poserEtatNumero(Object.assign({}, etatAvant, { verrouillee: true }));
    try {
      await medias._recepteur({ type: 'enregistrer', auto: false, medias: [
        { relatif: 'a.png', valeurs: { legende: 'Legende sous verrou', alt: 'desc', altDefini: true } }
      ] });
      await table._recepteur({ type: 'enregistrer', auto: true, modele: modele('sous verrou') });
      await apresDelai();
      table.dispose();
      await apresDelai();
      assert.strictEqual(c.appels, 0, 'une compilation est partie sur un numéro verrouillé');
    } finally {
      session.poserEtatNumero(etatAvant);
      c.restaurer();
    }
  });
