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
// appendChild/insertBefore/replaceChild (repositionnent vraiment, comme le vrai DOM — un
// nœud n'est jamais dupliqué), dataset, classList,
// value/checked/disabled/readOnly, childNodes/firstChild/nodeType/tagName
// (l'éditeur de tableau relit ses cellules nœud par nœud), et des sélecteurs réduits
// (« .classe », « balise », « [data-x] », « [data-x="v"] », « balise[data-x=v] », un
// attribut HTML ordinaire quelconque — « [name=v] », « [type="radio"] », plusieurs crochets
// accolés comme « input[name="…"][value="…"] » —, combinés par un espace). Les
// gestionnaires posés par addEventListener sont retenus et
// dispatchEvent({ type }) les déclenche : de quoi simuler un changement de <select> ou un
// clic — le formulaire des métadonnées permute ses langues sur ce geste.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');

// Les deux fichiers du poste que lib/i18n.js interroge pour choisir sa langue —
// C:\ProgramData\SZH\config.json et state.json — détournés vers des fichiers vides. Sans
// ce détour, un poste allemand (state.json porte la langue du dernier lanceur ouvert)
// ferait rendre à T() des textes allemands, et toute la suite, qui compare à des textes
// français, tomberait. Un test ne lit rien de la machine qui l'exécute. Posés seulement
// s'ils ne le sont pas déjà : plusieurs contrôles pointent SZH_CONFIG_OJS vers leur propre
// fichier, et c'est le leur qui doit gagner.
const POSTE_ESSAI = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-poste-dom-'));
for (const [variable, nom] of [['SZH_CONFIG_OJS', 'config.json'], ['SZH_ETAT_POSTE', 'state.json']]) {
  if (process.env[variable]) { continue; }
  const chemin = path.join(POSTE_ESSAI, nom);
  fs.writeFileSync(chemin, '{}' + String.fromCharCode(10));
  process.env[variable] = chemin;
}

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
// « [name=v] », « [type="radio"] ». L'attribut posé par setAttribute (table `attributs`,
// via getAttribute) fait foi en premier ; s'il manque, on retombe sur la propriété de même
// nom que le script de la page pose souvent directement (name, value, type, checked…),
// car rendre() écrit couramment `input.name = …` sans jamais appeler setAttribute — c'est
// le cas du radio de settings.js#cocher(), sélecteur `input[name="…"][value="…"]`.
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
  // Balise facultative devant, puis une suite de « .classe » et « [attribut] » dans
  // n'importe quel ordre — « balise », « .classe », « .a.b », « p.occ.visible »,
  // « select[data-x=v] », « input[name="…"][value="…"] » (deux crochets accolés, comme
  // dans settings.js#cocher()).
  const m = motif.match(/^([a-z]*)((?:\.[a-zA-Z0-9_-]+|\[[^\]]*\])*)$/);
  if (!m) { return false; }
  const balise = m[1];
  if (balise !== '' && e.balise !== balise) { return false; }
  const segments = m[2].match(/\.[a-zA-Z0-9_-]+|\[[^\]]*\]/g) || [];
  return segments.every((s) => (s[0] === '.' ? e.classes.has(s.slice(1)) : correspondAttribut(e, s)));
}

// Une liste de sélecteurs séparés par des virgules — « input, select, button » — rend
// l'union, dans l'ordre du document et sans doublon, comme le vrai DOM. Le formulaire des
// réglages s'en sert pour verrouiller d'un coup tous les contrôles d'un bloc ; sans cette
// forme, le harnais rendait une liste vide et le verrou paraissait ne rien faire.
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

function element(balise) {
  const e = {
    balise: String(balise || '').toLowerCase(),
    enfants: [], parent: null, dataset: {}, style: {}, attributs: {}, classes: new Set(),
    hidden: false, value: '', checked: false, disabled: false, readOnly: false,
    type: '', name: '',
    maxLength: 0, placeholder: '', accept: '', files: null, rows: 0,
    _texte: '',
    // Le strict nécessaire du DOM de nœuds : 3 pour un texte, 1 pour le reste.
    get childNodes() { return this.enfants; },
    get nodeType() { return this.balise === '#texte' ? 3 : 1; },
    get nodeValue() { return this.balise === '#texte' ? this._texte : null; },
    get tagName() { return this.balise.toUpperCase(); },
    // Comme le vrai DOM : le texte d'un élément est le sien PLUS celui de ses descendants.
    // Sans cette descente, toute page qui compose un libellé en nœuds — une part de nom
    // mise en gras, par exemple — se lirait vide dans les tests, et le harnais réclamerait
    // du innerHTML là où le DOM est justement la bonne réponse.
    get textContent() {
      if (this.enfants.length === 0) { return this._texte; }
      return this._texte + this.enfants.map((c) => c.textContent).join('');
    },
    set textContent(v) { this._texte = v === undefined || v === null ? '' : String(v); this.enfants = []; },
    // Un <select> expose ses <option>, comme le vrai DOM : une page qui contrôle qu'une
    // valeur stockée figure bien dans sa liste (media/documentation.js, poserValeurChoix)
    // lèverait sans cela sur `sel.options.length`.
    get options() { return this.enfants.filter((c) => c.balise === 'option'); },
    get firstChild() { return this.enfants[0] || null; },
    get className() { return Array.from(this.classes).join(' '); },
    set className(v) { this.classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); },
    // `el.id = x` doit se voir à `getAttribute('id')`, comme dans le vrai DOM : sans cet
    // aller-retour, une page qui pose l'id par la seule propriété (et non les deux, comme
    // le faisaient plusieurs pages avant leur nettoyage) semblait ne porter aucun id ici.
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
    // Comme le vrai DOM : insère AVANT `ref`, ou en fin de liste si `ref` est absent ou
    // introuvable — jamais en fin de liste dans tous les cas. Retire d'abord `c` de sa
    // position chez `e`, s'il y était déjà (le motif « appendChild, puis insertBefore pour
    // repositionner » ne doit pas le dupliquer).
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
    // Bouillonnement : seulement si `ev.bubbles` est vrai (comme `new Event(t, {bubbles:
    // true})`, jamais un simple `{ type: 'x' }` écrit à la main dans un test) — sans cette
    // garde, un événement construit sans intention de bouillonner se mettrait à réveiller
    // des écouteurs délégués sur des ancêtres, dans des tests qui n'ont jamais eu à s'en
    // soucier. C'est le cas d'une grille dont le DOM interne est reconstruit à chaque ajout
    // ou retrait de rangée (media/_commun.js, SZH.motsCles) : ses écouteurs sont posés en
    // délégation sur un conteneur qui survit, et un `input.dispatchEvent(new Event('input',
    // { bubbles: true }))` posé par la page (par ex. media/_fiches.js, choisir()) doit les
    // atteindre comme un vrai navigateur le ferait.
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
    // `_focused`/`_scrolled` : posés sur l'élément lui-même, pas sur un état partagé de la
    // page — un test qui veut prouver « ce champ précis a reçu le curseur » (revue F03,
    // focaliserChamp/focaliser) n'a qu'à relire l'élément qu'il a retrouvé par [data-cle].
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
  let surMessage = null;
  const document = {
    head: element('head'), body: element('body'), documentElement: element('html'),
    createElement: (b) => element(b),
    createElementNS: (ns, b) => element(b),
    createTextNode: (t) => Object.assign(element('#texte'), { _texte: String(t) }),
    createDocumentFragment: () => element('#fragment'),
    getElementById: (id) => (parId[id] = parId[id] || element('div')),
    // Les conteneurs de page (cartes, zones, sections…) ne sont pas rattachés à <body> — la
    // page les prend par getElementById et les garde en mémoire, comme dans l'éditeur (voir
    // racineDom() plus bas). Un `document.querySelector` qui ne regardait que sous <body>
    // (racine quasi toujours vide ici) ne trouvait donc jamais rien : on cherche dans <body>
    // ET dans chaque racine que la page a demandée par son id, sans doublon.
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
    FileReader: function () { this.readAsDataURL = () => {}; },
    // Un événement construit à la main (`new Event('input', { bubbles: true })`), comme le
    // fait media/_fiches.js pour prévenir un écouteur délégué après une écriture
    // programmatique. `dispatchEvent` (plus haut) lit `bubbles` sur l'objet qu'on lui passe,
    // qu'il vienne d'ici ou d'un simple littéral `{ type: 'x' }` posé par un test.
    Event: function (type, opts) {
      this.type = type;
      this.bubbles = !!(opts && opts.bubbles);
    },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    console: console
  };
  contexte.globalThis = contexte;
  vm.createContext(contexte);
  vm.runInContext(script, contexte, { filename: opts.page + '.js' });

  const racineDom = () => {
    // Le conteneur de la page : « cartes » pour les formulaires de fiches, « sections » pour
    // la Documentation (qui garde son sommaire dans un second conteneur, « sommaire », pris
    // par son nom dans les tests), « corps » pour le gestionnaire des médias, « lignes »
    // pour les vues d'ensemble. Ces éléments ne sont pas rattachés à <body> — la page les
    // prend par leur identifiant, comme dans l'éditeur — d'où cette recherche par nom
    // plutôt qu'un parcours depuis la racine.
    return parId.cartes || parId.sections || parId.corps || parId.lignes || document.body;
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

// Concatène extension.js et tous les lib/**/*.js : une fonction de libellés qui migre vers
// un module de lib/ (découpage d'extension.js, comme lib/medias-hote.js) doit continuer de
// s'y trouver — même préalable que sourceExtensionEtLib (test/js/hote-factice.js).
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

// Libellés que l'hôte injecte, relus dans extension.js (ou dans le module de lib/ qui a
// hérité de la fonction) : le test parle la même langue que la page réelle, sans recopier
// une liste qui divergerait.
function libellesHote(racine, fonctions) {
  const cockpit = path.join(racine, 'vscodium-extension', 'szh-cockpit');
  const { T } = chargerAvecVscodeFactice(path.join(cockpit, 'lib', 'i18n.js'));
  const src = sourceExtensionEtLib(cockpit);
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
