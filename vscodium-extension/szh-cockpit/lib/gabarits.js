// Moteur de gabarits : un sous-ensemble de Twig, texte brut, sans dépendance et sans
// vscode. Sert les courriels du cockpit (lib/courriel.js, mail-templates/*.twig) mais ne
// connaît rien d'eux : compiler(source, nom) analyse une fois, rendre(variables) rejoue
// autant de fois qu'il faut.
//
// Reconnu : {{ expr }} (chemin de variable, littéral, filtres |nom ou |nom(args)) ;
// {% if %}/{% elseif %}/{% else %}/{% endif %} avec x, not x, x == y, x != y, x is empty,
// x is defined, x is not empty, and/or (priorité not > and > or, sans parenthèses) ;
// {% for x in liste %}/{% else %}/{% endfor %} avec loop.index, loop.index0, loop.first,
// loop.last, loop.length ; {% set x = expr %} ; {# commentaire #} ; {% block nom %} au
// premier niveau ; le contrôle des blancs à la Twig ({%- -%} etc.).
// Non reconnu : parenthèses dans les conditions, expressions arithmétiques, macros,
// inclusion d'un autre gabarit, échappement HTML (le texte sort tel quel).
'use strict';

const FILTRES_CONNUS = [
  'default', 'upper', 'lower', 'trim', 'capitalize', 'join', 'length', 'first', 'last'
];

function erreur(nomGabarit, ligne, message) {
  return new Error('gabarit « ' + nomGabarit + ' », ligne ' + ligne + ' : ' + message);
}

// ---- Découpage en jetons : texte brut, {{ }}, {% %}, {# #} ----------------------------

const RE_TAG = /\{\{(-?)([\s\S]*?)(-?)\}\}|\{%(-?)([\s\S]*?)(-?)%\}|\{#(-?)([\s\S]*?)(-?)#\}/g;

// Le premier mot d'un tag est son nom, le reste son argument — « if x == y » devient
// nomTag: 'if', argument: 'x == y'.
function decouperTag(corps) {
  const t = corps.trim();
  const m = /^(\S+)\s*([\s\S]*)$/.exec(t);
  if (!m) { return { nomTag: '', argument: '' }; }
  return { nomTag: m[1], argument: m[2] };
}

function tokeniser(texte) {
  const jetons = [];
  let dernier = 0;
  let ligne = 1;
  RE_TAG.lastIndex = 0;
  let m;
  while ((m = RE_TAG.exec(texte))) {
    if (m.index > dernier) { jetons.push({ type: 'texte', valeur: texte.slice(dernier, m.index) }); }
    for (let i = dernier; i < m.index; i++) { if (texte[i] === '\n') { ligne++; } }
    if (m[2] !== undefined) {
      jetons.push({ type: 'sortie', expr: m[2].trim(), ligne, gauche: m[1] === '-', droite: m[3] === '-' });
    } else if (m[5] !== undefined) {
      const d = decouperTag(m[5]);
      jetons.push({
        type: 'tag', nomTag: d.nomTag, argument: d.argument, ligne,
        gauche: m[4] === '-', droite: m[6] === '-'
      });
    } else {
      jetons.push({ type: 'commentaire', ligne, gauche: m[7] === '-', droite: m[9] === '-' });
    }
    dernier = RE_TAG.lastIndex;
  }
  if (dernier < texte.length) { jetons.push({ type: 'texte', valeur: texte.slice(dernier) }); }
  return jetons;
}

// Un « - » collé à un délimiteur mange les blancs voisins, retours à la ligne compris.
function controlerBlancs(jetons) {
  for (let i = 0; i < jetons.length; i++) {
    const j = jetons[i];
    if (j.type === 'texte') { continue; }
    if (j.gauche && i > 0 && jetons[i - 1].type === 'texte') {
      jetons[i - 1].valeur = jetons[i - 1].valeur.replace(/\s+$/, '');
    }
    if (j.droite && i < jetons.length - 1 && jetons[i + 1].type === 'texte') {
      jetons[i + 1].valeur = jetons[i + 1].valeur.replace(/^\s+/, '');
    }
  }
}

// ---- Lexer d'expression : chemin, littéral, filtres, opérateurs de condition ----------

function lexerExpression(s, nomGabarit, ligne) {
  const jetons = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === "'" || c === '"') {
      const q = c; let j = i + 1; let buf = '';
      while (j < n && s[j] !== q) {
        if (s[j] === '\\' && j + 1 < n) { buf += s[j + 1]; j += 2; } else { buf += s[j]; j++; }
      }
      jetons.push({ t: 'str', v: buf }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9.]/.test(s[j])) { j++; }
      jetons.push({ t: 'num', v: Number(s.slice(i, j)) }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(s[j])) { j++; }
      jetons.push({ t: 'id', v: s.slice(i, j) }); i = j; continue;
    }
    if (c === '=' && s[i + 1] === '=') { jetons.push({ t: 'op', v: '==' }); i += 2; continue; }
    if (c === '!' && s[i + 1] === '=') { jetons.push({ t: 'op', v: '!=' }); i += 2; continue; }
    if ('.,()|'.indexOf(c) !== -1) { jetons.push({ t: 'op', v: c }); i++; continue; }
    throw erreur(nomGabarit, ligne, 'caractère inattendu dans une expression : « ' + c + ' »');
  }
  return jetons;
}

function creerCurseur(jetons) {
  let i = 0;
  return {
    regarder() { return jetons[i]; },
    avancer() { return jetons[i++]; },
    fini() { return i >= jetons.length; }
  };
}

function estId(cur, mot) { const t = cur.regarder(); return !!t && t.t === 'id' && t.v === mot; }
function estOp(cur, s) { const t = cur.regarder(); return !!t && t.t === 'op' && t.v === s; }

// chemin (a.b.c) ou littéral ('x', 3, true, false, null).
function analyserPrimaire(cur, nomGabarit, ligne) {
  const tok = cur.avancer();
  if (!tok) { throw erreur(nomGabarit, ligne, 'expression incomplète'); }
  if (tok.t === 'str' || tok.t === 'num') { return { type: 'litteral', valeur: tok.v }; }
  if (tok.t === 'id') {
    if (tok.v === 'true') { return { type: 'litteral', valeur: true }; }
    if (tok.v === 'false') { return { type: 'litteral', valeur: false }; }
    if (tok.v === 'null') { return { type: 'litteral', valeur: null }; }
    const parties = [tok.v];
    while (estOp(cur, '.')) {
      cur.avancer();
      const suite = cur.avancer();
      if (!suite || suite.t !== 'id') { throw erreur(nomGabarit, ligne, 'chemin de variable invalide'); }
      parties.push(suite.v);
    }
    return { type: 'chemin', parties };
  }
  throw erreur(nomGabarit, ligne, 'expression invalide');
}

// primaire, puis zéro ou plusieurs |filtre(args).
function analyserAvecFiltres(cur, nomGabarit, ligne) {
  const noeud = { base: analyserPrimaire(cur, nomGabarit, ligne), filtres: [] };
  while (estOp(cur, '|')) {
    cur.avancer();
    const nomTok = cur.avancer();
    if (!nomTok || nomTok.t !== 'id') { throw erreur(nomGabarit, ligne, 'nom de filtre attendu'); }
    if (FILTRES_CONNUS.indexOf(nomTok.v) === -1) {
      throw erreur(nomGabarit, ligne, 'filtre inconnu : ' + nomTok.v);
    }
    const args = [];
    if (estOp(cur, '(')) {
      cur.avancer();
      if (!estOp(cur, ')')) {
        args.push(analyserPrimaire(cur, nomGabarit, ligne));
        while (estOp(cur, ',')) { cur.avancer(); args.push(analyserPrimaire(cur, nomGabarit, ligne)); }
      }
      if (!estOp(cur, ')')) { throw erreur(nomGabarit, ligne, "« ) » attendue après les arguments du filtre"); }
      cur.avancer();
    }
    noeud.filtres.push({ nom: nomTok.v, args });
  }
  return noeud;
}

function analyserExpression(texte, nomGabarit, ligne) {
  const cur = creerCurseur(lexerExpression(texte, nomGabarit, ligne));
  const noeud = analyserAvecFiltres(cur, nomGabarit, ligne);
  if (!cur.fini()) { throw erreur(nomGabarit, ligne, 'expression mal formée : ' + texte); }
  return noeud;
}

// or (plus faible), and, not (plus fort), puis une comparaison ou une expression seule.
function analyserCondition(texte, nomGabarit, ligne) {
  const cur = creerCurseur(lexerExpression(texte, nomGabarit, ligne));
  function ou() {
    let g = et();
    while (estId(cur, 'or')) { cur.avancer(); g = { type: 'ou', gauche: g, droite: et() }; }
    return g;
  }
  function et() {
    let g = non();
    while (estId(cur, 'and')) { cur.avancer(); g = { type: 'et', gauche: g, droite: non() }; }
    return g;
  }
  function non() {
    if (estId(cur, 'not')) { cur.avancer(); return { type: 'non', valeur: non() }; }
    return comparaison();
  }
  function comparaison() {
    const gauche = analyserAvecFiltres(cur, nomGabarit, ligne);
    if (estOp(cur, '==')) { cur.avancer(); return { type: 'egal', gauche, droite: analyserAvecFiltres(cur, nomGabarit, ligne) }; }
    if (estOp(cur, '!=')) { cur.avancer(); return { type: 'different', gauche, droite: analyserAvecFiltres(cur, nomGabarit, ligne) }; }
    if (estId(cur, 'is')) {
      cur.avancer();
      let nier = false;
      if (estId(cur, 'not')) { nier = true; cur.avancer(); }
      if (estId(cur, 'empty')) { cur.avancer(); return { type: nier ? 'nonvide' : 'vide', valeur: gauche }; }
      if (estId(cur, 'defined')) { cur.avancer(); return { type: nier ? 'nondefini' : 'defini', valeur: gauche }; }
      throw erreur(nomGabarit, ligne, "« is » incomplet : « empty » ou « defined » attendu");
    }
    return { type: 'verite', valeur: gauche };
  }
  const noeud = ou();
  if (!cur.fini()) { throw erreur(nomGabarit, ligne, 'condition mal formée : ' + texte); }
  return noeud;
}

// ---- Analyse syntaxique : jetons -> arbre de nœuds ------------------------------------

const TAGS_FERMANTS = ['elseif', 'else', 'endif', 'endfor', 'endblock'];

function analyser(jetons, nomGabarit) {
  let pos = 0;
  const lect = {
    regarder() { return jetons[pos]; },
    avancer() { return jetons[pos++]; },
    fini() { return pos >= jetons.length; }
  };

  // Lit une suite de nœuds jusqu'à la fin des jetons ou jusqu'à un tag de `finAttendue`.
  function suite(finAttendue) {
    const noeuds = [];
    while (!lect.fini()) {
      const tok = lect.regarder();
      if (tok.type === 'texte') { noeuds.push({ type: 'texte', valeur: tok.valeur }); lect.avancer(); continue; }
      if (tok.type === 'commentaire') { lect.avancer(); continue; }
      if (tok.type === 'sortie') {
        noeuds.push({ type: 'var', expr: analyserExpression(tok.expr, nomGabarit, tok.ligne) });
        lect.avancer(); continue;
      }
      if (finAttendue && finAttendue.indexOf(tok.nomTag) !== -1) { return { noeuds, fin: tok.nomTag, tokFin: tok }; }
      if (tok.nomTag === 'if') { noeuds.push(analyserIf()); continue; }
      if (tok.nomTag === 'for') { noeuds.push(analyserFor()); continue; }
      if (tok.nomTag === 'set') { noeuds.push(analyserSet()); continue; }
      if (tok.nomTag === 'block') { noeuds.push(analyserBloc()); continue; }
      if (TAGS_FERMANTS.indexOf(tok.nomTag) !== -1) { throw erreur(nomGabarit, tok.ligne, 'tag inattendu ici : ' + tok.nomTag); }
      throw erreur(nomGabarit, tok.ligne, 'tag inconnu : ' + tok.nomTag);
    }
    return { noeuds, fin: null, tokFin: null };
  }

  function analyserSet() {
    const tok = lect.avancer();
    const idx = tok.argument.indexOf('=');
    if (idx === -1) { throw erreur(nomGabarit, tok.ligne, "« set » mal formé"); }
    const nom = tok.argument.slice(0, idx).trim();
    const expr = analyserExpression(tok.argument.slice(idx + 1).trim(), nomGabarit, tok.ligne);
    return { type: 'set', nom, expr };
  }

  function analyserIf() {
    const tokIf = lect.avancer();
    const branches = [{ cond: analyserCondition(tokIf.argument, nomGabarit, tokIf.ligne), corps: null }];
    let sinon = null;
    for (;;) {
      const r = suite(['elseif', 'else', 'endif']);
      branches[branches.length - 1].corps = r.noeuds;
      if (r.fin === 'elseif') {
        lect.avancer();
        branches.push({ cond: analyserCondition(r.tokFin.argument, nomGabarit, r.tokFin.ligne), corps: null });
        continue;
      }
      if (r.fin === 'else') {
        lect.avancer();
        const r2 = suite(['endif']);
        if (r2.fin !== 'endif') { throw erreur(nomGabarit, tokIf.ligne, "« if » non fermé"); }
        sinon = r2.noeuds;
        lect.avancer();
        break;
      }
      if (r.fin === 'endif') { lect.avancer(); break; }
      throw erreur(nomGabarit, tokIf.ligne, "« if » non fermé");
    }
    return { type: 'if', branches, sinon };
  }

  function analyserFor() {
    const tokFor = lect.avancer();
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]+)$/.exec(tokFor.argument);
    if (!m) { throw erreur(nomGabarit, tokFor.ligne, "« for » mal formé"); }
    const variable = m[1];
    const liste = analyserExpression(m[2].trim(), nomGabarit, tokFor.ligne);
    const r = suite(['else', 'endfor']);
    const corps = r.noeuds;
    let sinon = null;
    if (r.fin === 'else') {
      lect.avancer();
      const r2 = suite(['endfor']);
      if (r2.fin !== 'endfor') { throw erreur(nomGabarit, tokFor.ligne, "« for » non fermé"); }
      sinon = r2.noeuds;
      lect.avancer();
    } else if (r.fin === 'endfor') {
      lect.avancer();
    } else {
      throw erreur(nomGabarit, tokFor.ligne, "« for » non fermé");
    }
    return { type: 'for', variable, liste, corps, sinon };
  }

  function analyserBloc() {
    const tokBloc = lect.avancer();
    const r = suite(['endblock']);
    if (r.fin !== 'endblock') { throw erreur(nomGabarit, tokBloc.ligne, "« block » non fermé"); }
    lect.avancer();
    return { type: 'bloc', nom: tokBloc.argument, corps: r.noeuds };
  }

  return suite(null).noeuds;
}

// ---- Évaluation : arbre de nœuds + variables -> texte, et blocs collectés -------------

function evaluerChemin(parties, portee) {
  let v = portee;
  for (const p of parties) {
    if (v === null || v === undefined) { return undefined; }
    v = v[p];
  }
  return v;
}

function baseDefinie(noeud, portee) {
  return noeud.type === 'litteral' ? true : evaluerChemin(noeud.parties, portee) !== undefined;
}

function evaluerBase(noeud, portee) {
  return noeud.type === 'litteral' ? noeud.valeur : evaluerChemin(noeud.parties, portee);
}

// La vacuité à la Twig : '', 0, null, undefined, false, [] sont vides — et donc, pour
// `default`, remplaçables. C'est délibéré : `{{ 0|default('x') }}` rend bien « x ».
function estVide(v) {
  if (v === '' || v === 0 || v === null || v === undefined || v === false) { return true; }
  return Array.isArray(v) && v.length === 0;
}

function appliquerFiltre(nom, v, args) {
  switch (nom) {
    case 'default': return estVide(v) ? args[0] : v;
    case 'upper': return String(v == null ? '' : v).toUpperCase();
    case 'lower': return String(v == null ? '' : v).toLowerCase();
    case 'trim': return String(v == null ? '' : v).trim();
    case 'capitalize': {
      const s = String(v == null ? '' : v);
      return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
    }
    case 'join': return (Array.isArray(v) ? v : []).join(args[0] === undefined ? '' : String(args[0]));
    case 'length':
      if (Array.isArray(v) || typeof v === 'string') { return v.length; }
      if (v && typeof v === 'object') { return Object.keys(v).length; }
      return 0;
    case 'first':
      if (Array.isArray(v)) { return v[0]; }
      if (typeof v === 'string') { return v.charAt(0); }
      return undefined;
    case 'last':
      if (Array.isArray(v)) { return v[v.length - 1]; }
      if (typeof v === 'string') { return v.charAt(v.length - 1); }
      return undefined;
    default: return v; // inatteignable : le nom est validé à l'analyse
  }
}

function evaluerAvecFiltres(noeud, portee) {
  let v = evaluerBase(noeud.base, portee);
  for (const f of noeud.filtres) {
    v = appliquerFiltre(f.nom, v, f.args.map((a) => evaluerBase(a, portee)));
  }
  return v;
}

function estVrai(v) { return !estVide(v); }

function evaluerCondition(noeud, portee) {
  switch (noeud.type) {
    case 'ou': return evaluerCondition(noeud.gauche, portee) || evaluerCondition(noeud.droite, portee);
    case 'et': return evaluerCondition(noeud.gauche, portee) && evaluerCondition(noeud.droite, portee);
    case 'non': return !evaluerCondition(noeud.valeur, portee);
    case 'egal': return evaluerAvecFiltres(noeud.gauche, portee) == evaluerAvecFiltres(noeud.droite, portee); // eslint-disable-line eqeqeq
    case 'different': return evaluerAvecFiltres(noeud.gauche, portee) != evaluerAvecFiltres(noeud.droite, portee); // eslint-disable-line eqeqeq
    case 'vide': return estVide(evaluerAvecFiltres(noeud.valeur, portee));
    case 'nonvide': return !estVide(evaluerAvecFiltres(noeud.valeur, portee));
    case 'defini': return baseDefinie(noeud.valeur.base, portee);
    case 'nondefini': return !baseDefinie(noeud.valeur.base, portee);
    default: return estVrai(evaluerAvecFiltres(noeud.valeur, portee)); // 'verite'
  }
}

// Sortie de {{ expr }} : Twig rend un booléen vrai par « 1 », faux par rien — un raccourci
// qui surprend, mais nos gabarits n'affichent jamais un booléen brut ; les tests le
// couvrent pour mémoire.
function formaterValeur(v) {
  if (v === undefined || v === null || v === false) { return ''; }
  if (v === true) { return '1'; }
  if (Array.isArray(v)) { return v.join(', '); }
  return String(v);
}

function evaluerNoeuds(noeuds, portee, blocs) {
  let sortie = '';
  for (const n of noeuds) { sortie += evaluerNoeud(n, portee, blocs); }
  return sortie;
}

function evaluerNoeud(n, portee, blocs) {
  if (n.type === 'texte') { return n.valeur; }
  if (n.type === 'var') { return formaterValeur(evaluerAvecFiltres(n.expr, portee)); }
  if (n.type === 'set') { portee[n.nom] = evaluerAvecFiltres(n.expr, portee); return ''; }
  if (n.type === 'if') {
    for (const branche of n.branches) {
      if (evaluerCondition(branche.cond, portee)) { return evaluerNoeuds(branche.corps, portee, blocs); }
    }
    return n.sinon ? evaluerNoeuds(n.sinon, portee, blocs) : '';
  }
  if (n.type === 'for') {
    const brute = evaluerAvecFiltres(n.liste, portee);
    const tableau = Array.isArray(brute) ? brute : [];
    if (tableau.length === 0) { return n.sinon ? evaluerNoeuds(n.sinon, portee, blocs) : ''; }
    let sortie = '';
    for (let i = 0; i < tableau.length; i++) {
      const sousPortee = Object.assign({}, portee);
      sousPortee[n.variable] = tableau[i];
      sousPortee.loop = { index: i + 1, index0: i, first: i === 0, last: i === tableau.length - 1, length: tableau.length };
      sortie += evaluerNoeuds(n.corps, sousPortee, blocs);
    }
    return sortie;
  }
  if (n.type === 'bloc') { blocs[n.nom] = evaluerNoeuds(n.corps, portee, blocs); return ''; }
  return '';
}

// ---- API ------------------------------------------------------------------------------

function compiler(source, nom) {
  const nomGabarit = nom || '(gabarit)';
  const texte = String(source).replace(/\r\n/g, '\n');
  const jetons = tokeniser(texte);
  controlerBlancs(jetons);
  const ast = analyser(jetons, nomGabarit);
  return {
    rendre(variables) {
      const blocs = {};
      evaluerNoeuds(ast, Object.assign({}, variables || {}), blocs);
      return blocs;
    }
  };
}

function rendre(source, variables, nom) {
  return compiler(source, nom).rendre(variables);
}

module.exports = { compiler, rendre };
