(function () {
  'use strict';
  var vscodeApi = acquireVsCodeApi();

  // --- Bandeau + survol + clic->source (existant) --------------------------------
  var courant = null;
  document.getElementById('szh-basculer').addEventListener('click', function () {
    vscodeApi.postMessage({ type: 'basculer' });
  });
  // Éléments de BLOC : ce sont les seuls que le survol surligne. Pandoc pose des
  // positions (sourcepos) aussi sur l'INLINE — un <strong>, un <em>, un lien — donc un
  // simple closest('[data-pos]') surlignait « Morand » au milieu de « je suis Robin
  // Morand » au lieu du paragraphe entier. Or ce qu'on désigne ici, c'est un passage à
  // retrouver dans le texte source : l'unité utile est le bloc.
  var BLOCS = {
    P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, LI: 1, DT: 1, DD: 1,
    BLOCKQUOTE: 1, PRE: 1, FIGURE: 1, FIGCAPTION: 1, TABLE: 1, CAPTION: 1,
    UL: 1, OL: 1, DL: 1, DIV: 1, SECTION: 1, HEADER: 1, ASIDE: 1
  };

  // Remonte de `cible` jusqu'au premier élément de BLOC portant une position. On
  // s'arrête au plus INTERNE (le paragraphe, pas la section qui le contient) : c'est le
  // plus petit passage qui ait un sens dans la source.
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
    // Le bandeau (bouton « Voir en PDF ») a son propre gestionnaire : ne jamais
    // le traiter comme un clic de navigation.
    if (e.target && e.target.closest && e.target.closest('#szh-bandeau')) { return; }
    var res = resoudreClic(e.target, e.clientX, e.clientY);
    if (!res) { return; }
    e.preventDefault();
    // A2 : en plus du bloc (data-pos), on transmet le MOT sous le curseur pour viser
    // le mot exact dans la source (repli bloc côté hôte si vide/introuvable).
    vscodeApi.postMessage({ type: 'revele', pos: res.pos, mot: res.mot });
  });

  // G1 — résolution robuste d'un clic en { pos, mot }. Chemin normal : le bloc/mot
  // sous le curseur (closest data-pos), qui porte aussi le MOT exact pour l'A2.
  // Repli : un clic tombé dans une zone SANS position — typiquement un tableau
  // inclus, dont le RawBlock HTML n'a pas de data-pos — vise le bloc positionné le
  // plus proche dans l'ordre du document (jamais de clic « perdu », y compris pour
  // les blocs qui suivent un tableau). Pas de mot dans ce cas : le texte cliqué
  // (une cellule) n'appartient pas à la source .md.
  function resoudreClic(cible, x, y) {
    // Le BLOC, comme au survol : on ouvre exactement ce qu'on a surligné. Le mot sous
    // le curseur reste transmis pour que l'hôte y place le curseur (A2) — c'est une
    // précision de position, pas une réduction de la sélection.
    var c = blocDe(cible);
    if (c) { return { pos: c.getAttribute('data-pos'), mot: motAuPoint(x, y) }; }
    var voisin = blocPositionneLePlusProche(cible);
    if (voisin) { return { pos: voisin.getAttribute('data-pos'), mot: '' }; }
    return null;
  }

  // Bloc positionné (data-pos) le plus proche de `cible` dans l'ordre du document :
  // le dernier qui la précède, sinon le premier qui la suit. Sert au repli de clic
  // dans une zone non positionnée (tableau inclus).
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
  // « fichier@L1:C-L2:C » (ou « L1:C-L2:C ») -> { l1, l2 } (lignes source 1-based).
  // null si illisible. l2 = ligne de FIN (utile à l'interpolation G2 et au bloc
  // contenant une ligne, G3).
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

  // Blocs positionnés, triés par ligne source de début (= ordre du document).
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

  // Éditeur -> aperçu : positionner l'aperçu en face de `ligne` (fractionnaire
  // possible). G2 — interpolation INTRA-bloc : au lieu de caler au début du bloc
  // courant (paliers de plusieurs lignes dans un long paragraphe), on interpole
  // PROPORTIONNELLEMENT entre le sommet du bloc courant (dernière position <=
  // ligne) et celui du bloc suivant (première position à une ligne strictement
  // supérieure) -> suivi continu. Les positions inline (un span par mot, sur
  // chaque ligne rendue) donnent déjà une granularité fine ; l'interpolation
  // couvre les lignes sans span (lignes vides, ruptures internes).
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
    }, 35);
  }, { passive: true });

  // --- G3 : curseur/clic dans le .md -> surlignage côté aperçu -------------------
  var blocActif = null;      // dernier bloc surligné (classe szh-actif)
  var motActifSpan = null;   // dernier span de mot surligné (szh-mot-actif)

  // Bloc positionné dont la PLAGE source [ligne..ligneFin] contient `ligne`. Parmi
  // les candidats imbriqués (le div du bloc ET ses spans inline la contiennent),
  // on retient la plage la plus large -> le conteneur de bloc, pas un span de mot.
  // Repli : le dernier bloc dont la ligne de début <= `ligne`.
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

  // Enveloppe la 1re occurrence de `mot` (texte rendu du bloc) dans un span
  // szh-mot-actif — via l'API Range (aucune injection HTML). « Au mieux » : mot
  // répété -> 1re occurrence ; introuvable -> bloc seul.
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

  // Retire le surlignage précédent (bloc + mot), en restaurant le texte d'origine.
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
    // Amener en vue SEULEMENT si hors écran, sous la garde anti-boucle (le scroll
    // programmatique qui suit ne doit pas repartir en défilement inverse A1).
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
