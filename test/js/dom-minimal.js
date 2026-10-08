// DOM minimal pour exécuter le script d'une webview hors de l'éditeur.
//
// Une erreur au rendu d'une webview ne se voit pas dans l'éditeur : la page garde son titre,
// les cartes n'arrivent pas, sans message. Ce module charge le script assemblé et lui envoie
// des messages, dans un contexte où une exception remonte au test.
//
// N'implémente que ce que les webviews utilisent : createElement(NS), textContent,
// appendChild/insertBefore/replaceChild (qui déplacent le nœud sans le dupliquer), dataset,
// classList, value/checked/disabled/readOnly, childNodes/firstChild/nodeType/tagName, et des
// sélecteurs réduits (« .classe », « balise », « [data-x] », « [data-x="v"] »,
// « balise[data-x=v] », tout attribut ordinaire comme « [name=v] », plusieurs crochets
// accolés comme « input[name="…"][value="…"] », combinés par un espace). Les gestionnaires
// posés par addEventListener sont retenus, et dispatchEvent({ type }) les déclenche.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Les fichiers du poste qui décident de la langue, détournés : voir poste-isole.js.
require('./poste-isole');

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

// Un seul crochet « [data-x] », « [data-x="v"] », « [data-x='v'] » ou attribut ordinaire
// « [name=v] », « [type="radio"] ». L'attribut posé par setAttribute fait foi ; à défaut,
// la propriété de même nom, que les pages posent souvent directement (`input.name = …`).
function correspondAttribut(e, segment) {
  const mData = segment.match(/^\[data-([a-z-]+)(?:=("?)([^"\]]*)\2)?\]$/);
  if (mData) {
    const cle = mData[1].replace(/-([a-z])/g, (x, l) => l.toUpperCase());
    return mData[3] === undefined ? e.dataset[cle] !== undefined : e.dataset[cle] === mData[3];
  }
  const m = segment.match(/^\[([a-zA-Z_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^"'\]]*)))?\]$/);
  if (!m) { return false; }
  const attr = m[1];
  const aValeur = segment.indexOf('=') !== -1;
  const valeurAttendue = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
  const brut = e.getAttribute(attr);
  const surProps = e[attr] === undefined || e[attr] === '' || e[attr] === false ? undefined : String(e[attr]);
  const reel = brut !== null ? brut : surProps;
  return aValeur ? reel === valeurAttendue : reel !== undefined;
}

function correspond(e, motif) {
  // Balise facultative, puis une suite de « .classe » et « [attribut] » dans n'importe quel
  // ordre : « .a.b », « p.occ.visible », « input[name="…"][value="…"] ».
  const m = motif.match(/^([a-z]*)((?:\.[a-zA-Z0-9_-]+|\[[^\]]*\])*)$/);
  if (!m) { return false; }
  const balise = m[1];
  if (balise !== '' && e.balise !== balise) { return false; }
  const segments = m[2].match(/\.[a-zA-Z0-9_-]+|\[[^\]]*\]/g) || [];
  return segments.every((s) => (s[0] === '.' ? e.classes.has(s.slice(1)) : correspondAttribut(e, s)));
}

// Une liste de sélecteurs séparés par des virgules (« input, select, button ») rend l'union,
// sans doublon, comme le vrai DOM.
function chercher(racine, selecteur) {
  const listes = String(selecteur).split(',').map((x) => x.trim()).filter((x) => x !== '');
  if (listes.length > 1) {
    const vus = new Set();
    const union = [];
    for (const un of listes) {
      for (const e of chercherUn(racine, un)) {
        if (vus.has(e)) { continue; }
        vus.add(e);
        union.push(e);
      }
    }
    return union;
  }
  return chercherUn(racine, listes[0] || selecteur);
}

function chercherUn(racine, selecteur) {
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

function dateDuCalendrier(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) { return false; }
  const a = Number(m[1]), mois = Number(m[2]), j = Number(m[3]);
  if (a < 1 || mois < 1 || mois > 12 || j < 1) { return false; }
  return j <= new Date(Date.UTC(a, mois, 0)).getUTCDate();
}

function element(balise) {
  const e = {
    balise: String(balise || '').toLowerCase(),
    enfants: [], parent: null, dataset: {}, style: {}, attributs: {}, classes: new Set(),
    hidden: false, checked: false, disabled: false, readOnly: false,
    type: '', name: '',
    // Comme le navigateur (assainissement de la valeur, HTML §4.10.5.1.7) : un champ
    // type="date" vide toute valeur qui n'est pas une date du calendrier.
    _valeur: '',
    get value() { return this._valeur; },
    set value(v) {
      const s = v === undefined || v === null ? '' : String(v);
      this._valeur = (this.type === 'date' && s !== '' && !dateDuCalendrier(s)) ? '' : s;
    },
    maxLength: 0, placeholder: '', accept: '', files: null, rows: 0,
    _texte: '',
    // Le strict nécessaire du DOM de nœuds : 3 pour un texte, 1 pour le reste.
    get childNodes() { return this.enfants; },
    get nodeType() { return this.balise === '#texte' ? 3 : 1; },
    get nodeValue() { return this.balise === '#texte' ? this._texte : null; },
    get tagName() { return this.balise.toUpperCase(); },
    // Comme le vrai DOM : le texte d'un élément inclut celui de ses descendants.
    get textContent() {
      if (this.enfants.length === 0) { return this._texte; }
      return this._texte + this.enfants.map((c) => c.textContent).join('');
    },
    set textContent(v) { this._texte = v === undefined || v === null ? '' : String(v); this.enfants = []; },
    // Un <select> expose ses <option> (lu par media/documentation.js, poserValeurChoix).
    get options() { return this.enfants.filter((c) => c.balise === 'option'); },
    get firstChild() { return this.enfants[0] || null; },
    get className() { return Array.from(this.classes).join(' '); },
    set className(v) { this.classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); },
    // `el.id = x` se voit à `getAttribute('id')`, comme dans le vrai DOM.
    get id() { return this.attributs.id === undefined ? '' : this.attributs.id; },
    set id(v) { this.attributs.id = String(v); },
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
    // Comme le vrai DOM : insère avant `ref`, ou en fin de liste si `ref` est absent ou
    // introuvable. Retire d'abord `c` de sa position s'il était déjà là.
    insertBefore(c, ref) {
      c.parent = e;
      e.enfants = e.enfants.filter((x) => x !== c);
      const i = ref ? e.enfants.indexOf(ref) : -1;
      if (i === -1) { e.enfants.push(c); } else { e.enfants.splice(i, 0, c); }
      return c;
    },
    // Comme le vrai DOM : remplace `ancien` par `neuf` à sa place, et rend `ancien`.
    replaceChild(neuf, ancien) {
      const i = e.enfants.indexOf(ancien);
      neuf.parent = e;
      ancien.parent = null;
      if (i === -1) { e.enfants.push(neuf); } else { e.enfants[i] = neuf; }
      return ancien;
    },
    remove() { if (e.parent) { e.parent.removeChild(e); } },
    setAttribute(k, v) { e.attributs[k] = String(v); },
    getAttribute(k) { return e.attributs[k] === undefined ? null : e.attributs[k]; },
    removeAttribute(k) { delete e.attributs[k]; },
    _ecouteurs: {},
    addEventListener(t, f) { (e._ecouteurs[t] = e._ecouteurs[t] || []).push(f); },
    removeEventListener(t, f) { e._ecouteurs[t] = (e._ecouteurs[t] || []).filter((x) => x !== f); },
    // Déclenche les gestionnaires posés par addEventListener. L'objet passé tient lieu
    // d'événement ; toute exception d'un gestionnaire remonte au test, c'est voulu.
    //
    // Remonte aux ancêtres seulement si `ev.bubbles` est vrai (`new Event(t, { bubbles:
    // true })`), pas pour un simple `{ type: 'x' }` écrit dans un test. Les écouteurs
    // délégués (SZH.motsCles de media/_commun.js) reçoivent ainsi les événements que la page
    // émet avec bubbles (media/_fiches.js, choisir()).
    dispatchEvent(evt) {
      const ev = evt || {};
      if (!ev.preventDefault) { ev.preventDefault = () => {}; }
      const arreterOrigine = ev.stopPropagation;
      ev.stopPropagation = () => {
        ev._propagationArretee = true;
        if (arreterOrigine) { arreterOrigine(); }
      };
      if (!ev.target) { ev.target = e; }
      let courant = e;
      while (courant) {
        for (const f of (courant._ecouteurs[ev.type] || []).slice()) { f.call(courant, ev); }
        if (!ev.bubbles || ev._propagationArretee) { break; }
        courant = courant.parent;
      }
      return true;
    },
    querySelector(s) { return chercher(e, s)[0] || null; },
    querySelectorAll(s) { return chercher(e, s); },
    closest(s) {
      let n = e.parent;
      while (n) { if (correspond(n, s)) { return n; } n = n.parent; }
      return null;
    },
    // `_focused`/`_scrolled` sont posés sur l'élément : un test relit l'élément qu'il a
    // retrouvé pour savoir s'il a reçu le curseur.
    focus() { e._focused = true; }, click() { e.dispatchEvent({ type: 'click' }); },
    scrollIntoView() { e._scrolled = true; },
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
  const observes = [];
  let surMessage = null;
  const document = {
    head: element('head'), body: element('body'), documentElement: element('html'),
    createElement: (b) => element(b),
    createElementNS: (ns, b) => element(b),
    createTextNode: (t) => Object.assign(element('#texte'), { _texte: String(t) }),
    createDocumentFragment: () => element('#fragment'),
    getElementById: (id) => (parId[id] = parId[id] || element('div')),
    // Les conteneurs de page (cartes, sections…) ne sont pas rattachés à <body> : la page
    // les prend par getElementById. La recherche porte donc sur <body> et sur chaque racine
    // demandée par son id, sans doublon.
    querySelector: (s) => {
      for (const racine of [document.body].concat(Object.values(parId))) {
        const trouve = chercher(racine, s)[0];
        if (trouve) { return trouve; }
      }
      return null;
    },
    querySelectorAll: (s) => {
      const vus = new Set();
      const sortie = [];
      for (const racine of [document.body].concat(Object.values(parId))) {
        for (const e of chercher(racine, s)) {
          if (vus.has(e)) { continue; }
          vus.add(e);
          sortie.push(e);
        }
      }
      return sortie;
    },
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
    // Muet, sauf pour un faux fichier qui porte son `_dataUrl` : la lecture réussit aussitôt.
    FileReader: function () {
      this.readAsDataURL = (f) => { if (f && f._dataUrl) { this.result = f._dataUrl; this.onload(); } };
    },
    // `new Event('input', { bubbles: true })`, utilisé par media/_fiches.js. dispatchEvent
    // lit `bubbles` sur l'objet reçu.
    Event: function (type, opts) {
      this.type = type;
      this.bubbles = !!(opts && opts.bubbles);
    },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    // Retient ce que la page observe ; `redimensionner(largeur)` (plus bas) le déclenche.
    ResizeObserver: function (fn) {
      this.observe = (el) => { observes.push({ el: el, fn: fn }); };
      this.unobserve = () => {};
      this.disconnect = () => {};
    },
    console: console
  };
  contexte.globalThis = contexte;
  vm.createContext(contexte);
  vm.runInContext(script, contexte, { filename: opts.page + '.js' });

  const racineDom = () => {
    // Le conteneur de la page, pris par son id : « cartes » (fiches), « sections »
    // (Documentation, dont le « sommaire » se prend par son nom), « corps » (médias),
    // « lignes » (vues d'ensemble).
    return parId.cartes || parId.sections || parId.corps || parId.lignes || document.body;
  };
  return {
    document: document, parId: parId, messages: messages,
    envoyer: (msg) => {
      if (!surMessage) { throw new Error('la page n’écoute pas les messages'); }
      surMessage({ data: msg });
    },
    // Ce que verrait un ResizeObserver : chaque élément observé prend cette largeur.
    redimensionner: (largeur) => {
      for (const o of observes) { o.fn([{ target: o.el, contentRect: { width: largeur, height: 600 } }]); }
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

// Concatène extension.js et tous les lib/**/*.js : une fonction de libellés peut vivre dans
// l'un ou l'autre (comme sourceExtensionEtLib de test/js/hote-factice.js).
function sourceExtensionEtLib(cockpit) {
  const morceaux = [fs.readFileSync(path.join(cockpit, 'extension.js'), 'utf8')];
  const empiler = (base) => {
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      const p = path.join(base, e.name);
      if (e.isDirectory()) { empiler(p); }
      else if (e.name.endsWith('.js')) { morceaux.push(fs.readFileSync(p, 'utf8')); }
    }
  };
  empiler(path.join(cockpit, 'lib'));
  return morceaux.join('\n');
}

// Libellés que l'hôte injecte, relus dans le code source : le test utilise les mêmes textes
// que la page réelle.
function libellesHote(racine, fonctions) {
  const cockpit = path.join(racine, 'vscodium-extension', 'szh-cockpit');
  const { T } = chargerAvecVscodeFactice(path.join(cockpit, 'lib', 'i18n.js'));
  const src = sourceExtensionEtLib(cockpit);
  const txt = {};
  for (const nom of fonctions) {
    const i = src.indexOf('function ' + nom);
    if (i === -1) { throw new Error('fonction de libellés introuvable : ' + nom); }
    const bloc = src.slice(i, src.indexOf('\n}', i));
    // TP(clé, profilCourant()) se lit comme T(clé) : le harnais rend les textes de la revue.
    for (const m of bloc.matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*TP?\('([^']+)'(?:,\s*profilCourant\(\))?(?:,\s*\[[^\]]*\])?\)/g)) {
      txt[m[1]] = T(m[2]);
    }
  }
  return txt;
}

module.exports = { ouvrir, libellesHote, chargerAvecVscodeFactice };
