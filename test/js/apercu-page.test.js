// Le script de l'aperçu HTML, réellement exécuté.
//
//   node --test test/js/apercu-page.test.js
//
// apercu-hote.test.js éprouve l'hôte : il fabrique lui-même les messages « revele » et
// « scrollSource » et vérifie ce que l'hôte en fait. Personne n'exécutait la PAGE qui les
// émet — et le jour où media/apercu.js s'est mis à nommer le protocole par SZH.MSG, sans
// que son socle `SZH` soit posé (l'aperçu n'emprunte pas construireHtml, qui pose
// media/_messages.js dans les onze autres webviews), la page levait une ReferenceError au
// premier clic et au premier défilement. Les deux fonctions étaient mortes, toute la suite
// restait verte : le survol, lui, ne nomme aucun message et continuait de marcher, ce qui
// donnait une page d'apparence vivante.
//
// Ici la page est prise telle que l'hôte l'injecte — le HTML du vrai panneau, script
// compris — et jouée dans un DOM réduit à ce qu'elle utilise. Toute exception remonte.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { revueDEssai, activerHote } = require('./hote-factice');

const tick = () => new Promise((r) => setImmediate(r));
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
HOTE.arbre().definirRacine(REVUE);

// Trois blocs positionnés comme pandoc les rend en commonmark_x+sourcepos.
const CORPS = '<p data-pos="01-essai.md@3:1-3:20">Premier</p>'
            + '<p data-pos="01-essai.md@7:1-9:12">Deuxieme</p>'
            + '<p data-pos="01-essai.md@20:1-20:8">Troisieme</p>';

// L'aperçu déjà compilé, daté dans le futur : ouvrirArticle l'affiche sans passer par une
// compilation, comme dans apercu-hote.test.js.
function ecrireApercuCompile(slug, corps) {
  const dossier = path.join(REVUE, 'out', slug);
  fs.mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, slug + '.apercu.html');
  fs.writeFileSync(fichier, '<!DOCTYPE html><html><head></head><body>' + corps + '</body></html>');
  const futur = (Date.now() + 60000) / 1000;
  fs.utimesSync(fichier, futur, futur);
  return fichier;
}

// Le contenu du <script> que l'hôte a injecté dans la page.
function scriptDe(html) {
  const marque = html.match(/<script nonce="[^"]*">/);
  assert.ok(marque, 'aucun <script> dans le HTML injecté par l’hôte');
  const debut = marque.index + marque[0].length;
  const fin = html.lastIndexOf('</script>');
  assert.ok(fin > debut, '<script> non refermé dans le HTML injecté');
  return html.slice(debut, fin);
}

// ---- Le DOM réduit -----------------------------------------------------------------
// N'implémente que ce que media/apercu.js touche : les attributs et classes d'un bloc,
// son rectangle, la remontée par parentElement, et les gestionnaires posés sur le
// document et la fenêtre.
function elementFactice(balise, attributs) {
  const el = {
    tagName: String(balise).toUpperCase(),
    nodeType: 1,
    parentElement: null,
    _attrs: Object.assign({}, attributs || {}),
    _classes: new Set(),
    _rect: { top: 0, bottom: 0, height: 0 },
    _ecouteurs: {},
    hasAttribute: (n) => el._attrs[n] !== undefined,
    getAttribute: (n) => (el._attrs[n] === undefined ? null : el._attrs[n]),
    setAttribute: (n, v) => { el._attrs[n] = String(v); },
    classList: {
      add: (c) => { el._classes.add(c); },
      remove: (c) => { el._classes.delete(c); },
      contains: (c) => el._classes.has(c)
    },
    getBoundingClientRect: () => el._rect,
    scrollIntoView: () => {},
    // Le seul sélecteur que la page passe à closest() est « #szh-bandeau ».
    closest: (sel) => {
      let n = el;
      while (n) {
        if (n._attrs.id !== undefined && sel === '#' + n._attrs.id) { return n; }
        n = n.parentElement;
      }
      return null;
    },
    addEventListener: (t, f) => { (el._ecouteurs[t] = el._ecouteurs[t] || []).push(f); },
    dispatchEvent: (ev) => {
      for (const f of (el._ecouteurs[ev.type] || []).slice()) { f(ev); }
      return true;
    }
  };
  return el;
}

// Joue le script de la page sur `blocs` (des elementFactice porteurs de data-pos) et rend
// de quoi lui parler : ses messages vers l'hôte, son bouton de bascule, et de quoi
// déclencher un événement du document ou de la fenêtre.
function jouerPage(script, blocs) {
  const messages = [];
  const bandeau = elementFactice('div', { id: 'szh-bandeau' });
  const bouton = elementFactice('button', { id: 'szh-basculer' });
  bouton.parentElement = bandeau;
  const parId = { 'szh-bandeau': bandeau, 'szh-basculer': bouton };
  const corps = elementFactice('body', {});
  for (const b of blocs) { b.parentElement = corps; }

  const ecouteursDoc = {};
  const ecouteursFen = {};
  const documentFactice = {
    body: corps,
    getElementById: (id) => parId[id] || null,
    querySelectorAll: (sel) => (sel === '[data-pos]' ? blocs.slice() : []),
    createElement: (b) => elementFactice(b, {}),
    addEventListener: (t, f) => { (ecouteursDoc[t] = ecouteursDoc[t] || []).push(f); }
  };
  const fenetre = {
    addEventListener: (t, f) => { (ecouteursFen[t] = ecouteursFen[t] || []).push(f); },
    pageYOffset: 0,
    innerHeight: 800,
    scrollTo: () => {}
  };
  const contexte = {
    document: documentFactice,
    window: fenetre,
    acquireVsCodeApi: () => ({ postMessage: (m) => messages.push(m) }),
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Node: { DOCUMENT_POSITION_PRECEDING: 2, DOCUMENT_POSITION_FOLLOWING: 4 },
    NodeFilter: { SHOW_TEXT: 4 },
    console: console
  };
  contexte.globalThis = contexte;
  vm.createContext(contexte);
  vm.runInContext(script, contexte, { filename: 'apercu.js' });

  const declencher = (table, ev) => {
    for (const f of (table[ev.type] || []).slice()) { f(ev); }
  };
  return {
    messages: messages,
    bouton: bouton,
    surDocument: (ev) => declencher(ecouteursDoc, ev),
    surFenetre: (ev) => declencher(ecouteursFen, ev),
    // Le protocole tel que la page l'a chargé : ce que le socle manquant emportait.
    protocole: () => contexte.SZH && contexte.SZH.MSG
  };
}

// Les trois blocs, avec le rectangle qu'ils occuperaient à l'écran : les deux premiers
// au-dessus du seuil du bandeau (le second de peu — c'est lui, le bloc « au sommet »),
// le troisième bien plus bas.
function blocsDEssai() {
  const faire = (pos, top) => {
    const el = elementFactice('p', { 'data-pos': pos });
    el._rect = { top: top, bottom: top + 40, height: 40 };
    return el;
  };
  return [
    faire('01-essai.md@3:1-3:20', -50),
    faire('01-essai.md@7:1-9:12', -10),
    faire('01-essai.md@20:1-20:8', 100)
  ];
}

let PAGE = null;

test('mise en route : le démarrage se tait', async () => {
  for (let i = 0; i < 30; i++) { await tick(); }
  HOTE.erreurs.length = 0;
  HOTE.avertissements.length = 0;
});

test('la page de l’aperçu se charge sans lever, protocole compris', async () => {
  ecrireApercuCompile('01-essai', CORPS);
  await HOTE.executer('szh.ouvrirArticle', '01-essai');
  const panneau = HOTE.panneauDeType('szhApercuHtml');
  assert.ok(panneau, 'le panneau d’aperçu HTML ne s’est pas ouvert');

  // Lève si le socle manque : SZH.MSG y est lu dès le chargement des gestionnaires.
  PAGE = jouerPage(scriptDe(panneau.html), blocsDEssai());

  const msg = PAGE.protocole();
  assert.ok(msg, 'la table du protocole (SZH.MSG) n’est pas posée dans la page de l’aperçu');
  assert.strictEqual(msg.REVELE, 'revele');
  assert.strictEqual(msg.SCROLL_SOURCE, 'scrollSource');
});

test('le bouton du bandeau demande la bascule HTML / PDF', () => {
  const avant = PAGE.messages.length;
  PAGE.bouton.dispatchEvent({ type: 'click' });
  // Les objets naissent dans le contexte vm : on compare des champs, pas des prototypes.
  const recus = PAGE.messages.slice(avant).map((m) => m.type);
  assert.deepStrictEqual(recus, ['basculer']);
});

test('cliquer un passage de l’aperçu renvoie sa position dans le .md', () => {
  const blocs = blocsDEssai();
  const page = jouerPage(scriptDe(HOTE.panneauDeType('szhApercuHtml').html), blocs);
  page.surDocument({ type: 'click', target: blocs[1], clientX: 5, clientY: 5, preventDefault: () => {} });

  const recus = page.messages.filter((m) => m.type === 'revele');
  assert.strictEqual(recus.length, 1,
    'le clic n’a pas émis un « revele » unique : ' + JSON.stringify(page.messages));
  assert.strictEqual(recus[0].pos, '01-essai.md@7:1-9:12',
    'le clic ne renvoie pas la position du bloc cliqué');
});

test('faire défiler l’aperçu annonce à l’hôte la ligne source au sommet', async () => {
  const blocs = blocsDEssai();
  const page = jouerPage(scriptDe(HOTE.panneauDeType('szhApercuHtml').html), blocs);
  page.surFenetre({ type: 'scroll' });
  await attendre(80);   // le défilement est regroupé derrière un setTimeout(35)

  const recus = page.messages.filter((m) => m.type === 'scrollSource');
  assert.strictEqual(recus.length, 1,
    'le défilement n’a pas émis un « scrollSource » unique : ' + JSON.stringify(page.messages));
  assert.strictEqual(recus[0].ligne, 7,
    'la ligne annoncée n’est pas celle du bloc au sommet (1-based)');
});

test('un message « surligner » de l’hôte marque le bloc de la ligne visée', () => {
  const blocs = blocsDEssai();
  const page = jouerPage(scriptDe(HOTE.panneauDeType('szhApercuHtml').html), blocs);
  page.surFenetre({ type: 'message', data: { type: 'surligner', ligne: 8, mot: '' } });

  assert.ok(blocs[1].classList.contains('szh-actif'),
    'le bloc qui contient la ligne 8 (7-9) n’a pas été surligné');
  assert.ok(!blocs[0].classList.contains('szh-actif'), 'un autre bloc a été surligné');
  assert.ok(!blocs[2].classList.contains('szh-actif'), 'un autre bloc a été surligné');
});

test('sortie : ni erreur ni avertissement de l’hôte', () => {
  assert.deepStrictEqual(HOTE.erreurs, []);
  assert.deepStrictEqual(HOTE.avertissements, []);
});
