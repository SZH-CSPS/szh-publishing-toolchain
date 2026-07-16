(function () {
  'use strict';
  var vscodeApi = acquireVsCodeApi();

  // --- Bandeau + survol + clic->source (existant) --------------------------------
  var courant = null;
  document.getElementById('szh-basculer').addEventListener('click', function () {
    vscodeApi.postMessage({ type: 'basculer' });
  });
  document.addEventListener('mouseover', function (e) {
    var c = e.target && e.target.closest ? e.target.closest('[data-pos]') : null;
    if (courant === c) { return; }
    if (courant) { courant.classList.remove('szh-survol'); }
    courant = c;
    if (courant) { courant.classList.add('szh-survol'); }
  });
  document.addEventListener('click', function (e) {
    var c = e.target && e.target.closest ? e.target.closest('[data-pos]') : null;
    if (!c) { return; }
    e.preventDefault();
    // A2 : en plus du bloc (data-pos), on transmet le MOT sous le curseur pour viser
    // le mot exact dans la source (repli bloc côté hôte si vide/introuvable).
    vscodeApi.postMessage({ type: 'revele', pos: c.getAttribute('data-pos'), mot: motAuPoint(e.clientX, e.clientY) });
  });

  // A2 — mot sous le point (x, y) via l'API de caret du moteur (Chromium/Electron).
  // Étend depuis l'offset du clic jusqu'aux délimiteurs (espaces + ponctuation
  // courante). Chaîne vide si clic hors texte ou entre deux mots.
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

  // --- A1 : défilement synchronisé -----------------------------------------------
  // « fichier@L:C-L:C » (ou « L:C-… ») -> L (numéro de ligne source, 1-based). null si illisible.
  function ligneDe(pos) {
    var t = String(pos || '');
    var d = t.indexOf('@') !== -1 ? t.slice(t.indexOf('@') + 1) : t;
    var m = d.match(/^(\d+):/);
    return m ? parseInt(m[1], 10) : null;
  }

  // Blocs positionnés, triés par ligne source (= ordre du document).
  var blocs = [];
  function indexerBlocs() {
    blocs = [];
    var els = document.querySelectorAll('[data-pos]');
    for (var i = 0; i < els.length; i++) {
      var l = ligneDe(els[i].getAttribute('data-pos'));
      if (l !== null) { blocs.push({ el: els[i], ligne: l }); }
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

  // Éditeur -> aperçu : amener au sommet le bloc dont la ligne de début est la plus
  // proche (<=) de `ligne`.
  function scrollVersLigne(ligne) {
    if (!blocs.length) { indexerBlocs(); }
    if (!blocs.length) { return; }
    var cible = blocs[0];
    for (var i = 0; i < blocs.length; i++) {
      if (blocs[i].ligne <= ligne) { cible = blocs[i]; } else { break; }
    }
    defilementProgrammatique = true;
    var y = cible.el.getBoundingClientRect().top + (window.pageYOffset || 0) - bandeauHauteur() - 4;
    window.scrollTo(0, Math.max(0, y));
    if (minuteurProg) { clearTimeout(minuteurProg); }
    minuteurProg = setTimeout(function () { defilementProgrammatique = false; }, 150);
  }

  // Aperçu -> éditeur : bloc actuellement au sommet du viewport (celui dont le haut
  // est le plus bas tout en restant au-dessus du seuil sous le bandeau).
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
    }, 70);
  }, { passive: true });

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg) { return; }
    if (msg.type === 'scroll') { scrollVersLigne(parseInt(msg.ligne, 10) || 1); }
  });

  indexerBlocs();
})();
