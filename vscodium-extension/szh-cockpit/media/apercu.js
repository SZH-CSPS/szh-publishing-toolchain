(function () {
  'use strict';
  var vscodeApi = acquireVsCodeApi();

  // ---- Bandeau, survol et clic vers la source ----
  var courant = null;
  document.getElementById('szh-basculer').addEventListener('click', function () {
    vscodeApi.postMessage({ type: 'basculer' });
  });
  // Le survol ne surligne que des éléments de bloc : pandoc pose aussi des positions sur
  // l'en-ligne, si bien qu'un simple closest('[data-pos]') surlignerait un mot en gras au
  // lieu de son paragraphe.
  var BLOCS = {
    P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, LI: 1, DT: 1, DD: 1,
    BLOCKQUOTE: 1, PRE: 1, FIGURE: 1, FIGCAPTION: 1, TABLE: 1, CAPTION: 1,
    UL: 1, OL: 1, DL: 1, DIV: 1, SECTION: 1, HEADER: 1, ASIDE: 1
  };

  function blocDe(cible) {
    var el = cible;
    while (el && el.nodeType === 1 && el !== document.body) {
      if (el.hasAttribute('data-pos') && BLOCS[el.tagName]) { return el; }
      el = el.parentElement;
    }
    return null;
  }

  document.addEventListener('mouseover', function (e) {
    var c = blocDe(e.target);
    if (courant === c) { return; }
    if (courant) { courant.classList.remove('szh-survol'); }
    courant = c;
    if (courant) { courant.classList.add('szh-survol'); }
  });
  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('#szh-bandeau')) { return; }
    var res = resoudreClic(e.target, e.clientX, e.clientY);
    if (!res) { return; }
    e.preventDefault();
    // En plus du bloc, on transmet le mot sous le curseur pour viser le mot exact dans
    // la source ; l'hôte se replie sur le bloc s'il est vide ou introuvable.
    vscodeApi.postMessage({ type: 'revele', pos: res.pos, mot: res.mot });
  });

  // Résout un clic en { pos, mot } : normalement le bloc sous le curseur, comme au survol,
  // plus le mot pointé pour que l'hôte y place le curseur. Un clic tombé dans une zone
  // sans position, typiquement un tableau inclus, vise le bloc positionné le plus proche
  // dans l'ordre du document ; aucun mot n'est transmis alors, le texte d'une cellule
  // n'appartenant pas à la source .md.
  function resoudreClic(cible, x, y) {
    var c = blocDe(cible);
    if (c) { return { pos: c.getAttribute('data-pos'), mot: motAuPoint(x, y) }; }
    var voisin = blocPositionneLePlusProche(cible);
    if (voisin) { return { pos: voisin.getAttribute('data-pos'), mot: '' }; }
    return null;
  }

  function blocPositionneLePlusProche(cible) {
    if (!cible || !cible.compareDocumentPosition) { return null; }
    var els = document.querySelectorAll('[data-pos]');
    var precedent = null, suivant = null;
    for (var i = 0; i < els.length; i++) {
      var rel = cible.compareDocumentPosition(els[i]);
      if (rel & Node.DOCUMENT_POSITION_PRECEDING) { precedent = els[i]; }
      else if ((rel & Node.DOCUMENT_POSITION_FOLLOWING) && !suivant) { suivant = els[i]; }
    }
    return precedent || suivant;
  }

  // Mot sous le point (x, y), via l'API de caret du moteur : on étend depuis l'offset du
  // clic jusqu'aux délimiteurs. Chaîne vide hors du texte ou entre deux mots.
  function motAuPoint(x, y) {
    var noeud = null, offset = 0;
    if (document.caretRangeFromPoint) {
      var r = document.caretRangeFromPoint(x, y);
      if (r) { noeud = r.startContainer; offset = r.startOffset; }
    } else if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      if (p) { noeud = p.offsetNode; offset = p.offset; }
    }
    if (!noeud || noeud.nodeType !== 3) { return ''; }
    var texte = noeud.nodeValue || '';
    var i = Math.max(0, Math.min(offset, texte.length));
    var estMot = function (ch) { return ch !== '' && /[^\s.,;:!?()\[\]{}«»"'…—–\/]/.test(ch); };
    var deb = i, fin = i;
    while (deb > 0 && estMot(texte.charAt(deb - 1))) { deb--; }
    while (fin < texte.length && estMot(texte.charAt(fin))) { fin++; }
    return texte.slice(deb, fin);
  }

  // ---- Défilement synchronisé ----

  // « fichier@L1:C-L2:C », ou « L1:C-L2:C », -> { l1, l2 }, lignes comptées à partir de 1 ;
  // null si illisible.
  function bornesDe(pos) {
    var t = String(pos || '');
    var d = t.indexOf('@') !== -1 ? t.slice(t.indexOf('@') + 1) : t;
    var m = d.match(/^(\d+):\d+-(\d+):/);
    if (!m) {
      var s = d.match(/^(\d+):/);
      return s ? { l1: parseInt(s[1], 10), l2: parseInt(s[1], 10) } : null;
    }
    return { l1: parseInt(m[1], 10), l2: parseInt(m[2], 10) };
  }

  var blocs = [];
  function indexerBlocs() {
    blocs = [];
    var els = document.querySelectorAll('[data-pos]');
    for (var i = 0; i < els.length; i++) {
      var b = bornesDe(els[i].getAttribute('data-pos'));
      if (b) { blocs.push({ el: els[i], ligne: b.l1, ligneFin: b.l2 }); }
    }
    blocs.sort(function (a, b) { return a.ligne - b.ligne; });
  }

  function bandeauHauteur() {
    var b = document.getElementById('szh-bandeau');
    return b ? b.getBoundingClientRect().height : 0;
  }

  // Garde anti-boucle : ignore le scroll déclenché par notre propre défilement.
  var defilementProgrammatique = false;
  var minuteurProg = null;
  var minuteurScroll = null;

  function sommetAbsolu(el) {
    return el.getBoundingClientRect().top + (window.pageYOffset || 0);
  }

  // Éditeur -> aperçu : place l'aperçu en face de `ligne`. Caler au début du bloc courant
  // donnerait des paliers de plusieurs lignes dans un long paragraphe ; on interpole donc
  // entre le sommet du bloc courant et celui du bloc suivant, ce qui couvre aussi les
  // lignes sans span.
  function scrollVersLigne(ligne) {
    if (!blocs.length) { indexerBlocs(); }
    if (!blocs.length) { return; }
    var i = 0;
    for (var k = 0; k < blocs.length; k++) {
      if (blocs[k].ligne <= ligne) { i = k; } else { break; }
    }
    var courant = blocs[i];
    var y = sommetAbsolu(courant.el);
    var suivant = null;
    for (var j = i + 1; j < blocs.length; j++) {
      if (blocs[j].ligne > courant.ligne) { suivant = blocs[j]; break; }
    }
    if (suivant) {
      var portee = suivant.ligne - courant.ligne;
      var frac = portee > 0 ? (ligne - courant.ligne) / portee : 0;
      if (frac < 0) { frac = 0; } else if (frac > 1) { frac = 1; }
      y += frac * (sommetAbsolu(suivant.el) - y);
    }
    defilementProgrammatique = true;
    window.scrollTo(0, Math.max(0, y - bandeauHauteur() - 4));
    if (minuteurProg) { clearTimeout(minuteurProg); }
    minuteurProg = setTimeout(function () { defilementProgrammatique = false; }, 150);
  }

  function blocAuSommet() {
    var seuil = bandeauHauteur() + 6;
    var choix = null, meilleur = -Infinity;
    for (var i = 0; i < blocs.length; i++) {
      var top = blocs[i].el.getBoundingClientRect().top;
      if (top <= seuil && top > meilleur) { meilleur = top; choix = blocs[i]; }
    }
    if (!choix && blocs.length) { choix = blocs[0]; }
    return choix;
  }

  window.addEventListener('scroll', function () {
    if (defilementProgrammatique) { return; }
    if (minuteurScroll) { clearTimeout(minuteurScroll); }
    minuteurScroll = setTimeout(function () {
      if (!blocs.length) { indexerBlocs(); }
      var c = blocAuSommet();
      if (c) { vscodeApi.postMessage({ type: 'scrollSource', ligne: c.ligne }); }
    }, 35);
  }, { passive: true });

  // ---- Curseur ou clic dans le .md -> surlignage dans l'aperçu ----
  var blocActif = null;      // dernier bloc surligné
  var motActifSpan = null;   // dernier span de mot surligné

  // Bloc positionné dont la plage source contient `ligne`. Le div du bloc et ses spans la
  // contiennent tous : on retient la plage la plus large, donc le conteneur. À défaut, le
  // dernier bloc qui commence avant la ligne.
  function blocContenant(ligne) {
    var choix = null, ampli = -1;
    for (var i = 0; i < blocs.length; i++) {
      var b = blocs[i];
      if (b.ligne <= ligne && b.ligneFin >= ligne) {
        var a = b.ligneFin - b.ligne;
        if (a > ampli) { ampli = a; choix = b; }
      }
    }
    if (!choix) {
      for (var j = 0; j < blocs.length; j++) { if (blocs[j].ligne <= ligne) { choix = blocs[j]; } }
    }
    return choix;
  }

  // Enveloppe la première occurrence de `mot` dans le texte rendu du bloc, par l'API Range
  // et sans injection HTML. Un mot introuvable laisse le bloc seul surligné.
  function surlignerMot(el, mot) {
    if (!mot) { return; }
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var n;
    while ((n = w.nextNode())) {
      var idx = n.nodeValue.indexOf(mot);
      if (idx !== -1) {
        var r = document.createRange();
        r.setStart(n, idx);
        r.setEnd(n, idx + mot.length);
        var span = document.createElement('span');
        span.className = 'szh-mot-actif';
        try { r.surroundContents(span); motActifSpan = span; } catch (e) { /* plage non enveloppable */ }
        return;
      }
    }
  }

  function nettoyerSurlignage() {
    if (blocActif) { blocActif.classList.remove('szh-actif'); blocActif = null; }
    if (motActifSpan && motActifSpan.parentNode) {
      var p = motActifSpan.parentNode;
      while (motActifSpan.firstChild) { p.insertBefore(motActifSpan.firstChild, motActifSpan); }
      p.removeChild(motActifSpan);
      p.normalize();
    }
    motActifSpan = null;
  }

  function surligner(ligne, mot) {
    if (!blocs.length) { indexerBlocs(); }
    var cible = blocContenant(ligne);
    nettoyerSurlignage();
    if (!cible) { return; }
    cible.el.classList.add('szh-actif');
    blocActif = cible.el;
    surlignerMot(cible.el, mot);
    // Amener en vue seulement si le bloc est hors écran, sous la garde anti-boucle : le
    // défilement programmatique qui suit ne doit pas repartir en sens inverse.
    var r = cible.el.getBoundingClientRect();
    if (r.top < bandeauHauteur() || r.bottom > (window.innerHeight || 0)) {
      defilementProgrammatique = true;
      cible.el.scrollIntoView({ block: 'nearest' });
      if (minuteurProg) { clearTimeout(minuteurProg); }
      minuteurProg = setTimeout(function () { defilementProgrammatique = false; }, 150);
    }
  }

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg) { return; }
    if (msg.type === 'scroll') { scrollVersLigne(parseInt(msg.ligne, 10) || 1); }
    if (msg.type === 'surligner') { surligner(parseInt(msg.ligne, 10) || 1, msg.mot || ''); }
  });

  indexerBlocs();
})();
