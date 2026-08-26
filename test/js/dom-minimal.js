// DOM minimal pour exécuter le script d'une webview hors de l'éditeur.
//
// Pourquoi : les webviews du cockpit sont du JavaScript sans dépendance qui construit ses
// pages en DOM. Rien ne l'exécutait jamais avant qu'un rédacteur n'ouvre le formulaire — et
// une erreur au rendu ne se voit pas : la page garde son titre et son bouton, les cartes
// n'arrivent jamais, et aucun message ne le dit. C'est arrivé deux fois. Ce module donne de
// quoi charger le script assemblé et lui envoyer un message, dans un contexte où une
// exception remonte au test.
//
// N'implémente que ce que les webviews utilisent : createElement(NS), textContent,
// appendChild, dataset, classList, value/checked/disabled, childNodes/nodeType/tagName
// (l'éditeur de tableau relit ses cellules nœud par nœud), et des sélecteurs réduits
// (« .classe », « balise », « [data-x] », « [data-x="v"] », « balise[data-x=v] »,
// combinés par un espace). Les gestionnaires posés par addEventListener sont retenus et
// dispatchEvent({ type }) les déclenche : de quoi simuler un changement de <select> ou un
// clic — le formulaire des métadonnées permute ses langues sur ce geste.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Charge un module de lib/ en neutralisant `require('vscode')`, absent hors de l'éditeur.
function chargerAvecVscodeFactice(chemin) {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (r, p, i) {
    if (r === 'vscode') {
      return { workspace: { getConfiguration: () => ({ get: () => '' }) }, env: { language: 'fr' } };
    }
    return orig(r, p, i);
  };
  try { return require(chemin); } finally { Module._load = orig; }
}

function correspond(e, motif) {
  // « [data-x] », « [data-x="v"] », « select[data-x=v] » : balise facultative devant,
  // guillemets facultatifs autour de la valeur — les deux formes existent dans les pages.
  const m = motif.match(/^([a-z]*)\[data-([a-z-]+)(?:=("?)([^"\]]*)\3)?\]$/);
  if (m) {
    if (m[1] !== '' && e.balise !== m[1]) { return false; }
    const cle = m[2].replace(/-([a-z])/g, (x, l) => l.toUpperCase());
    return m[4] === undefined ? e.dataset[cle] !== undefined : e.dataset[cle] === m[4];
  }
  // « balise », « .classe », « .a.b », « p.occ.visible » : la balise si elle est nommée,
  // puis toutes les classes demandées.
  const parties = motif.split('.');
  const balise = parties.shift();
  if (balise !== '' && e.balise !== balise) { return false; }
  return parties.every((c) => e.classes.has(c));
}

function chercher(racine, selecteur) {
  let courants = [racine];
  for (const motif of String(selecteur).trim().split(/\s+/)) {
    const suivants = [];
    const visiter = (e) => {
      for (const c of e.enfants) {
        if (correspond(c, motif)) { suivants.push(c); }
        visiter(c);
      }
    };
    courants.forEach(visiter);
    courants = suivants;
  }
  return courants;
}

function element(balise) {
  const e = {
    balise: String(balise || '').toLowerCase(),
    enfants: [], parent: null, dataset: {}, style: {}, attributs: {}, classes: new Set(),
    hidden: false, value: '', checked: false, disabled: false, type: '', name: '',
    maxLength: 0, placeholder: '', accept: '', files: null, rows: 0,
    _texte: '',
    // Le strict nécessaire du DOM de nœuds : 3 pour un texte, 1 pour le reste.
    get childNodes() { return this.enfants; },
    get nodeType() { return this.balise === '#texte' ? 3 : 1; },
    get nodeValue() { return this.balise === '#texte' ? this._texte : null; },
    get tagName() { return this.balise.toUpperCase(); },
    get textContent() { return this._texte; },
    set textContent(v) { this._texte = v === undefined || v === null ? '' : String(v); this.enfants = []; },
    get className() { return Array.from(this.classes).join(' '); },
    set className(v) { this.classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); },
    classList: {
      add() { for (const x of arguments) { e.classes.add(x); } },
      remove() { for (const x of arguments) { e.classes.delete(x); } },
      toggle(x, f) {
        const pose = f === undefined ? !e.classes.has(x) : !!f;
        if (pose) { e.classes.add(x); } else { e.classes.delete(x); }
      },
      contains(x) { return e.classes.has(x); }
    },
    appendChild(c) { c.parent = e; e.enfants.push(c); return c; },
    removeChild(c) { e.enfants = e.enfants.filter((x) => x !== c); return c; },
    insertBefore(c) { c.parent = e; e.enfants.push(c); return c; },
    remove() { if (e.parent) { e.parent.removeChild(e); } },
    setAttribute(k, v) { e.attributs[k] = String(v); },
    getAttribute(k) { return e.attributs[k] === undefined ? null : e.attributs[k]; },
    removeAttribute(k) { delete e.attributs[k]; },
    _ecouteurs: {},
    addEventListener(t, f) { (e._ecouteurs[t] = e._ecouteurs[t] || []).push(f); },
    removeEventListener(t, f) { e._ecouteurs[t] = (e._ecouteurs[t] || []).filter((x) => x !== f); },
    // Déclenche les gestionnaires posés par addEventListener. L'objet passé tient lieu
    // d'événement ; toute exception d'un gestionnaire remonte au test, c'est voulu.
    dispatchEvent(evt) {
      const ev = evt || {};
      if (!ev.preventDefault) { ev.preventDefault = () => {}; }
      if (!ev.target) { ev.target = e; }
      for (const f of (e._ecouteurs[ev.type] || []).slice()) { f.call(e, ev); }
      return true;
    },
    querySelector(s) { return chercher(e, s)[0] || null; },
    querySelectorAll(s) { return chercher(e, s); },
    closest(s) {
      let n = e.parent;
      while (n) { if (correspond(n, s)) { return n; } n = n.parent; }
      return null;
    },
    focus() {}, click() { e.dispatchEvent({ type: 'click' }); }, scrollIntoView() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
  };
  return e;
}

// Assemble la page comme l'hôte, exécute son script, et rend de quoi lui parler.
//   ouvrir({ racine, page, cssPartage, jsPartage, txt })
//     -> { document, parId, messages, envoyer(msg), compter(selecteur), textes(),
//           compterPage(selecteur), conteneur() }
// `compter` cherche sous le conteneur de la page ; `compterPage` sous <body>, pour ce
// qu'une webview y accroche directement — une modale, un voile. `conteneur` rend
// l'élément lui-même, dont les classes portent parfois un état de la page.
// `envoyer` laisse remonter toute exception du gestionnaire de messages : c'est ce qu'on
// veut voir échouer dans un test.
function ouvrir(opts) {
  const cockpit = path.join(opts.racine, 'vscodium-extension', 'szh-cockpit');
  const { construireHtml } = chargerAvecVscodeFactice(path.join(cockpit, 'lib', 'webviews', 'util.js'));
  const html = construireHtml(opts.page, 'nonce-essai', {
    cssPartage: opts.cssPartage || [],
    jsPartage: opts.jsPartage || [],
    titre: 'essai',
    remplacements: opts.txt ? { '__TXT__': JSON.stringify(opts.txt) } : {}
  });
  const debut = html.indexOf('<script nonce="nonce-essai">') + '<script nonce="nonce-essai">'.length;
  const script = html.slice(debut, html.lastIndexOf('</script>'));

  const parId = {};
  const messages = [];
  let surMessage = null;
  const document = {
    head: element('head'), body: element('body'), documentElement: element('html'),
    createElement: (b) => element(b),
    createElementNS: (ns, b) => element(b),
    createTextNode: (t) => Object.assign(element('#texte'), { _texte: String(t) }),
    createDocumentFragment: () => element('#fragment'),
    getElementById: (id) => (parId[id] = parId[id] || element('div')),
    querySelector: () => null, querySelectorAll: () => [],
    // Le menu contextuel de l'éditeur de tableau pose et retire des gestionnaires
    // globaux : les deux doivent exister, en simples réceptacles.
    addEventListener: () => {}, removeEventListener: () => {},
    hidden: false, activeElement: null
  };
  const contexte = {
    document: document,
    window: {
      addEventListener: (t, f) => { if (t === 'message') { surMessage = f; } },
      removeEventListener: () => {}
    },
    acquireVsCodeApi: () => ({ postMessage: (m) => messages.push(m), setState: () => {}, getState: () => null }),
    FileReader: function () { this.readAsDataURL = () => {}; },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    console: console
  };
  contexte.globalThis = contexte;
  vm.createContext(contexte);
  vm.runInContext(script, contexte, { filename: opts.page + '.js' });

  const racineDom = () => {
    // Le conteneur de la page : « cartes » pour les formulaires de fiches, « corps » pour
    // le gestionnaire des médias, « lignes » pour les vues d'ensemble. Ces éléments ne sont
    // pas rattachés à <body> — la page les prend par leur identifiant, comme dans
    // l'éditeur — d'où cette recherche par nom plutôt qu'un parcours depuis la racine.
    return parId.cartes || parId.corps || parId.lignes || document.body;
  };
  return {
    document: document, parId: parId, messages: messages,
    envoyer: (msg) => {
      if (!surMessage) { throw new Error('la page n’écoute pas les messages'); }
      surMessage({ data: msg });
    },
    compter: (selecteur) => chercher(racineDom(), selecteur).length,
    compterPage: (selecteur) => chercher(document.body, selecteur).length,
    conteneur: () => racineDom(),
    // Les valeurs des champs : un mot-clé ou un titre vit dans `value`, pas dans le texte.
    valeurs: () => chercher(racineDom(), 'input').map((e) => e.value).filter((v) => v !== ''),
    textes: () => {
      const sortie = [];
      const visiter = (e) => {
        if (e._texte) { sortie.push(e._texte); }
        for (const c of e.enfants) { visiter(c); }
      };
      visiter(racineDom());
      return sortie;
    }
  };
}

// Libellés que l'hôte injecte, relus dans extension.js : le test parle la même langue que
// la page réelle, sans recopier une liste qui divergerait.
function libellesHote(racine, fonctions) {
  const cockpit = path.join(racine, 'vscodium-extension', 'szh-cockpit');
  const { T } = chargerAvecVscodeFactice(path.join(cockpit, 'lib', 'i18n.js'));
  const src = fs.readFileSync(path.join(cockpit, 'extension.js'), 'utf8');
  const txt = {};
  for (const nom of fonctions) {
    const i = src.indexOf('function ' + nom);
    if (i === -1) { throw new Error('fonction de libellés introuvable : ' + nom); }
    const bloc = src.slice(i, src.indexOf('\n}', i));
    for (const m of bloc.matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*T\('([^']+)'(?:,\s*\[[^\]]*\])?\)/g)) {
      txt[m[1]] = T(m[2]);
    }
  }
  return txt;
}

module.exports = { ouvrir, libellesHote, chargerAvecVscodeFactice };
