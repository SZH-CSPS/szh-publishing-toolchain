// Socle commun des webviews, injecté par construireHtml avant le script de la page.
// Sans dépendance ni accès réseau : rien que du DOM.
//
//   SZH.autoEnregistrement(opts)  enregistrement automatique, sans voler le curseur
//   SZH.motsCles(opts)            éditeur de mots-clés appariés, partagé par les trois
//                                 formulaires qui touchent aux mots-clés
//   SZH.choixFerme(opts)          un intitulé et un <select> à liste fermée, sur une carte
//   SZH.choixLangue(opts)         le <select> de la langue d'un article, posé sur sa carte
//   SZH.annoncerPret(api, recu)   « pret », redemandé tant que l'hôte se tait
//   SZH.modeTradJamais()          cette page ne détourne pas ses clics (mode « Trad »)
//   SZH.icone(nom)                une icône de 16 px, dessinée en SVG
//   SZH.notif(ton, contenu)       une notification : info, ok, attention, danger
//   SZH.poser(parent, balise, …)  créer, classer, remplir, insérer : le geste de base
//   SZH.modale(opts)              le voile, la boîte, Échap et le retour du focus
//   SZH.poserAccent(hex)          la couleur annuelle du numéro devient l'accent
//   SZH.barreBoutons(...)         la barre de commandes d'une vue, et sa zone d'état
//   SZH.listeCartes(opts)         la liste de cartes des vues d'ensemble
//   SZH.suivreHauteur(zone, max)  un textarea à la hauteur de son texte, jusqu'à un plafond
var SZH = (function () {
  'use strict';

  // ---- Icônes ----
  //
  // Un jeu minimal en SVG : une icône suit la couleur du texte (`currentColor`) et reste
  // nette à toutes les échelles. Chaque dessin est une liste de primitives
  // [balise, attributs] : cercles et rectangles quand c'est possible, un tracé sinon, car
  // une longue donnée de path se relit et se corrige mal.
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var TRACE_POUBELLE = 'M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zM9 2H6v1h3V2zM4 13h7V4H4v9zm2-8H5v7h1V5zm1 0h1v7H7V5zm2 0h1v7H9V5z';
  var TRACE_CAMERA = 'M6.2 2a1 1 0 0 0-.9.55L4.6 4H2.5A1.5 1.5 0 0 0 1 5.5v7A1.5 1.5 0 0 0 2.5 14h11a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 13.5 4h-2.1l-.7-1.45a1 1 0 0 0-.9-.55H6.2zM8 6a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5zm0 1.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z';
  var CONTOUR = { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' };

  var ICONES = {
    poubelle: [['path', { d: TRACE_POUBELLE, 'fill-rule': 'evenodd', 'clip-rule': 'evenodd' }]],
    camera: [['path', { d: TRACE_CAMERA, 'fill-rule': 'evenodd', 'clip-rule': 'evenodd' }]],
    info: [
      ['circle', { cx: '8', cy: '8', r: '6.75', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' }],
      ['rect', { x: '7.25', y: '6.9', width: '1.5', height: '5', rx: '.4' }],
      ['rect', { x: '7.25', y: '3.9', width: '1.5', height: '1.7', rx: '.4' }]
    ],
    attention: [
      ['path', { d: 'M8 1.6 15.1 14H.9L8 1.6z', fill: 'none', stroke: 'currentColor',
        'stroke-width': '1.5', 'stroke-linejoin': 'round' }],
      ['rect', { x: '7.25', y: '5.8', width: '1.5', height: '4', rx: '.4' }],
      ['rect', { x: '7.25', y: '10.7', width: '1.5', height: '1.6', rx: '.4' }]
    ],
    danger: [
      ['circle', { cx: '8', cy: '8', r: '6.75', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' }],
      ['path', { d: 'M5.7 5.7l4.6 4.6M10.3 5.7l-4.6 4.6', fill: 'none', stroke: 'currentColor',
        'stroke-width': '1.5', 'stroke-linecap': 'round' }]
    ],
    ok: [['path', { d: 'M6.4 11.9 2.9 8.4 4 7.3l2.4 2.4 5.6-5.6 1.1 1.1z' }]],
    // Fermer un message : deux traits nus, sans cercle autour, qui en ferait l'icône
    // `danger`.
    croix: [['path', { d: 'M4.3 4.3 11.7 11.7M11.7 4.3 4.3 11.7', fill: 'none',
      stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round' }]],
    // Ajouter : deux barres. Le libellé du bouton dit quoi.
    plus: [['path', { d: 'M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25V3z' }]],
    // Rien n'est commencé : le cercle vide de l'arbre.
    cercle: [['circle', { cx: '8', cy: '8', r: '5.5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' }]],
    // Envoyer pour traduction : deux alphabets et une plume.
    traduction: [
      ['path', { d: 'M1.5 2.5h6v1.5h-6zM3.5 4.5h2v1.2c0 2.2-1 3.9-2.6 4.9l-.8-1.3c1.2-.7 2-1.9 2-3.6V4.5z' }],
      ['path', { d: 'M8.5 13.5h6v-1.5h-6zM10.5 6.5h2v5.2h-2z', opacity: '.55' }],
      ['path', { d: 'M6.2 8.1 7.3 7l3.4 3.4-1.1 1.1z' }]
    ],
    // Les deux étapes du suivi de traduction : passer la main, puis relire.
    fleche: [['path', { d: 'M8.5 3.5 13 8l-4.5 4.5-1.06-1.06L10.4 8.75H3v-1.5h7.4L7.44 4.56 8.5 3.5z' }]],
    // Déplacer un article dans le numéro : la même flèche, debout.
    haut: [['path', { d: 'M8 2.5 12.5 7l-1.06 1.06L8.75 5.35V13h-1.5V5.35L4.56 8.06 3.5 7 8 2.5z' }]],
    bas: [['path', { d: 'M8 13.5 3.5 9l1.06-1.06L7.25 10.65V3h1.5v7.65l2.69-2.71L12.5 9 8 13.5z' }]],
    // Un tableau : le cadre et ses deux filets, en contour comme l'imprimante. Sert à
    // l'éditeur de tableaux, destination d'un bouton de constat (lib/constats.js, lieu « table »).
    tableau: [
      ['rect', Object.assign({ x: '2', y: '2.75', width: '12', height: '10.5', rx: '1' }, CONTOUR)],
      ['path', Object.assign({ d: 'M2 6.25h12M6.5 6.25v7' }, CONTOUR)]
    ],
    // Déplier : un chevron, sans hampe (une flèche se lirait « télécharger »).
    chevron: [['path', { d: 'M8 10.6 3.3 5.9l1.06-1.06L8 8.48l3.64-3.64L12.7 5.9 8 10.6z' }]],
    oeil: [
      ['path', { d: 'M8 3.25C4.7 3.25 2 5.15 1.15 8 2 10.85 4.7 12.75 8 12.75s6-1.9 6.85-4.75C14 5.15 11.3 3.25 8 3.25zm0 1.5c2.4 0 4.4 1.3 5.25 3.25C12.4 9.95 10.4 11.25 8 11.25S3.6 9.95 2.75 8C3.6 6.05 5.6 4.75 8 4.75z' }],
      ['circle', { cx: '8', cy: '8', r: '1.9' }]
    ],
    // L'œil fermé : une paupière baissée et trois cils, plutôt qu'un œil barré : à 14 px, le
    // trait oblique se confondrait avec le dessin plein de `oeil`, alors que la paupière
    // change la silhouette. Les cils partent de la courbe elle-même (t = .25, .5, .75).
    'oeil-ferme': [
      ['path', { d: 'M2 7.5Q8 13 14 7.5', fill: 'none', stroke: 'currentColor',
        'stroke-width': '1.6', 'stroke-linecap': 'round' }],
      ['path', { d: 'M5 9.6 4 11.4M8 10.3V12.3M11 9.6 12 11.4', fill: 'none', stroke: 'currentColor',
        'stroke-width': '1.6', 'stroke-linecap': 'round' }]
    ],
    // Agrandir un aperçu : un cercle en contour et un manche oblique.
    loupe: [
      ['circle', { cx: '7', cy: '7', r: '4.25', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' }],
      ['path', { d: 'M10.4 10.4 14 14', fill: 'none', stroke: 'currentColor',
        'stroke-width': '1.5', 'stroke-linecap': 'round' }]
    ],
    // Imprimer : le corps et la feuille, deux rectangles en contour (CONTOUR), comme les
    // icônes voisines de la barre. Des rectangles pleins se fondraient en un seul bloc noir
    // à 14 px.
    imprimante: [
      ['rect', Object.assign({ x: '2', y: '6', width: '12', height: '6', rx: '1' }, CONTOUR)],
      ['rect', Object.assign({ x: '5', y: '2', width: '6', height: '4.5' }, CONTOUR)]
    ],
    // Éditer : un crayon, en contour (onglet Archive, « Éditer », grisé).
    crayon: [
      ['path', { d: 'M11.3 1.7a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L6 13l-3.3.7L3.4 10.4 11.3 1.7z',
        fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linejoin': 'round' }],
      ['path', { d: 'M9.7 3.3 12.7 6.3', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4' }]
    ]
  };

  function icone(nom) {
    var dessin = ICONES[nom];
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    if (!dessin) { return svg; }                    // nom inconnu : une icône vide, pas d'erreur
    for (var i = 0; i < dessin.length; i++) {
      var forme = document.createElementNS(SVG_NS, dessin[i][0]);
      var attrs = dessin[i][1];
      for (var cle in attrs) { forme.setAttribute(cle, attrs[cle]); }
      svg.appendChild(forme);
    }
    return svg;
  }

  // ---- Un élément, posé dans son parent ----
  //
  // Créer, classer, remplir, insérer : le geste de base de toutes les pages.
  function poser(parent, balise, cls, contenu) {
    var e = document.createElement(balise);
    if (cls) { e.className = cls; }
    if (contenu !== undefined && contenu !== null) { e.textContent = contenu; }
    parent.appendChild(e);
    return e;
  }

  // ---- Modale ----
  //
  // Le voile, la boîte, la fermeture au clic à côté et à Échap, et le retour du focus là
  // d'où l'on vient, sans quoi le clavier repartirait du haut de la page. Le style est dans
  // _design.css (.szh-modale, .szh-modale-boite, .szh-modale-pied) ; la boîte prend la
  // classe que l'appelant lui donne.
  //
  // opts.classeBoite   classes de la boîte, « szh-modale-boite » par défaut
  // opts.construire(boite)   remplit la boîte, appelé une seule fois
  // opts.surOuverture(boite) / opts.surFermeture()
  // opts.focus()       l'élément à focaliser à l'ouverture
  function modale(opts) {
    var o = opts || {};
    var voile = null;
    var boite = null;
    var retour = null;

    function fermer() {
      if (!voile) { return; }
      voile.classList.remove('visible');
      if (o.surFermeture) { o.surFermeture(); }
      if (retour) {
        try { retour.focus(); } catch (e) { /* élément disparu entre-temps */ }
        retour = null;
      }
    }

    function construire() {
      voile = poser(document.body, 'div', 'szh-modale');
      voile.setAttribute('role', 'dialog');
      voile.setAttribute('aria-modal', 'true');
      boite = poser(voile, 'div', o.classeBoite || 'szh-modale-boite');
      // Cliquer à côté referme ; Échap aussi, seule sortie au clavier.
      voile.addEventListener('click', function (ev) { if (ev.target === voile) { fermer(); } });
      document.addEventListener('keydown', function (ev) {
        if ((ev.key === 'Escape' || ev.key === 'Esc') && voile.classList.contains('visible')) {
          fermer();
        }
      });
      if (o.construire) { o.construire(boite); }
    }

    function ouvrir() {
      if (!voile) { construire(); }
      retour = document.activeElement || null;
      if (o.surOuverture) { o.surOuverture(boite); }
      voile.classList.add('visible');
      if (o.focus) {
        var cible = o.focus();
        if (cible) { try { cible.focus(); } catch (e) { /* pas focalisable */ } }
      }
    }

    return { ouvrir: ouvrir, fermer: fermer, boite: function () { return boite; } };
  }

  // ---- Accent du numéro ----
  //
  // La couleur annuelle lue dans ausgabe.yaml, que _design.css reprend comme accent. Elle
  // est validée avant d'entrer dans une propriété CSS : une valeur venue de l'hôte n'entre
  // pas telle quelle dans une feuille de style.
  function poserAccent(hex) {
    var valide = /^#[0-9A-Fa-f]{6}$/.test(String(hex || ''));
    try {
      // Retirer la propriété quand l'hôte n'envoie rien : le numéro peut avoir perdu sa
      // couleur, et le panneau se recharge sans être refermé.
      if (valide) { document.documentElement.style.setProperty('--szh-accent', hex); }
      else { document.documentElement.style.removeProperty('--szh-accent'); }
    } catch (e) { /* pas de racine stylable : le socle garde sa couleur de repli */ }
  }

  // ---- Notifications ----
  //
  // Un seul objet pour tous les messages du cockpit ; le ton dit la nature : `info` pour ce
  // qui explique, `ok` pour ce qui a réussi, `attention` pour ce qui mérite un regard,
  // `danger` pour ce qui bloquera la publication. Le style est dans _design.css.
  // `contenu` est un texte, ou une liste de nœuds quand le message porte de la mise en
  // forme ; pas de HTML injecté.
  function notif(ton, contenu, opts) {
    var o = opts || {};
    var p = document.createElement('p');
    p.className = 'szh-notif szh-notif--' + ton + (o.discret ? ' szh-notif--discret' : '');
    // La variante discrète n'a pas de pictogramme : elle s'écrit aussi à la main dans le
    // HTML d'une page, sans SVG, et les deux doivent se ressembler.
    if (!o.discret) { p.appendChild(icone(ton === 'ok' ? 'ok' : (ton === 'info' ? 'info' : ton))); }
    var corps = document.createElement('span');
    if (Array.isArray(contenu)) {
      for (var i = 0; i < contenu.length; i++) { corps.appendChild(contenu[i]); }
    } else {
      corps.textContent = String(contenu === undefined || contenu === null ? '' : contenu);
    }
    p.appendChild(corps);
    return p;
  }

  // ---- Enregistrement automatique ----
  //
  // Trois déclencheurs : un délai après la dernière frappe (pour ne pas écrire au milieu
  // d'un mot) ; la perte de focus ou le changement d'un champ ; la perte de focus de la
  // webview ou son passage en arrière-plan, dernier moment avant que VS Code ne détruise le
  // DOM (ces panneaux n'ont pas `retainContextWhenHidden`). L'hôte répond sans renvoyer les
  // valeurs quand la demande est automatique, pour ne pas refaire le rendu pendant la saisie.
  //
  // `opts.delai` à 0 supprime le minuteur et le déclencheur au champ, ne laissant que la
  // perte de focus de la webview : c'est ce qu'il faut à la fiche image, dont l'écriture
  // recompile l'article.
  function autoEnregistrement(opts) {
    var delai = opts.delai === undefined ? 3000 : opts.delai;
    var surChamp = delai > 0;
    var minuteur = null;
    var enVol = false;          // une écriture est partie, on attend l'accusé
    var redemander = false;     // …et une modification est arrivée entre-temps

    function annuler() {
      if (minuteur) { clearTimeout(minuteur); minuteur = null; }
    }
    function ecrire() {
      annuler();
      if (!opts.estModifie()) { return; }
      if (enVol) { redemander = true; return; }
      enVol = true;
      opts.enregistrer(true);
    }
    function programmer() {
      if (!surChamp) { return; }
      annuler();
      minuteur = setTimeout(ecrire, delai);
    }
    function confirme() {
      enVol = false;
      if (redemander) { redemander = false; ecrire(); }
    }

    if (surChamp) {
      document.addEventListener('input', programmer, true);
      // « change » en phase de remontée, et non en capture : le gestionnaire de la cible doit
      // avoir marqué sa modification avant qu'on décide d'écrire.
      document.addEventListener('change', ecrire, false);
      document.addEventListener('focusout', ecrire, true);
    }
    window.addEventListener('blur', ecrire);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { ecrire(); }
    });

    return { ecrire: ecrire, programmer: programmer, confirme: confirme, annuler: annuler };
  }

  // ---- Mots-clés appariés ----
  //
  // « diagnostic » ↔ « Diagnose » : le seul lien entre les listes est la position. D'où
  // cette grille, une rangée par mot-clé et une colonne par langue, dont l'ordre ne se
  // modifie pas à la souris ; on ajoute ou retire une rangée entière, jamais un mot dans
  // une seule langue, et l'appariement reste juste. Une case vide s'écrit avec la marque,
  // sans quoi la valeur disparaîtrait à la sérialisation et la suite remonterait d'un cran.
  //
  // opts.langues  [{ code, libelle, lecture }]  lecture:true = colonne non éditable
  // opts.listes   { fr:[…], de:[…] }            valeurs de départ
  // opts.textes   { motCle, sansEquivalent, ajouter, retirer }
  // opts.edition  rangées ajoutables et retirables, ou structure figée pour le panneau de
  //               traduction, où l'on traduit sans inventer de mots-clés
  // opts.onChange appelé à chaque frappe et à chaque ajout ou retrait de rangée
  // opts.surRendu appelé à la fin de rendre(), une fois le DOM interne reconstruit, pour
  //               reposer ce que rendre() vient d'effacer (_fiches.js : la pastille « hors
  //               thésaurus », absente du modèle)
  //
  // collecter() rend les listes déjà alignées : chaque langue entamée est complétée par
  // la marque, et une langue dont aucune case n'est remplie rend une liste vide.
  // permuter(a, b) échange les listes de deux langues, colonnes masquées comprises.
  var MARQUE = 'TO BE TRANSLATED';
  var styleMotsClesPose = false;

  function estMarque(mot) {
    return String(mot === undefined || mot === null ? '' : mot).trim().toUpperCase() === MARQUE;
  }

  function poserStyleMotsCles() {
    if (styleMotsClesPose) { return; }
    styleMotsClesPose = true;
    var style = document.createElement('style');
    style.textContent = [
      '.mc { display: flex; flex-direction: column; gap: .25rem; margin: .3rem 0 .2rem; }',
      '.mc-rangee { display: grid; align-items: center; gap: .4rem; padding: .1em .15em; border-radius: 2px; }',
      '.mc-rangee .mc-num { color: var(--encre-2); font-size: .85em; text-align: right; }',
      '.mc-entete { font-weight: 600; font-size: .85em; color: var(--encre-2); }',
      '.mc-entete .mc-num { visibility: hidden; }',
      '.mc-lecture { padding: .25em .45em; border-radius: 2px; overflow-wrap: anywhere;',
      '  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.1));',
      '  border: 1px dashed var(--vscode-panel-border, rgba(128,128,128,.4)); }',
      '.mc-lecture.mc-vide { color: var(--encre-2); font-style: italic; border-style: dotted; }',
      '.mc input { width: 100%; box-sizing: border-box; padding: .25em .45em; font: inherit;',
      '  color: var(--vscode-input-foreground); background: var(--vscode-input-background);',
      '  border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; }',
      '.mc input:focus { outline: 1px solid var(--vscode-focusBorder); }',
      '.mc button.mc-retirer { padding: .15em .4em; border: none; border-radius: 2px; cursor: pointer;',
      '  font: inherit; line-height: 1; color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));',
      '  background: var(--vscode-button-secondaryBackground, var(--vscode-button-background)); }',
      '.mc-pied { margin-top: .15rem; }',
      '.mc-pied button { padding: .25em .7em; border: none; border-radius: 2px; cursor: pointer; font: inherit;',
      '  color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));',
      '  background: var(--vscode-button-secondaryBackground, var(--vscode-button-background)); }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function motsCles(opts) {
    poserStyleMotsCles();
    var textes = opts.textes || {};
    var element = document.createElement('div');
    var langues = opts.langues || [];
    var corps = null;
    // Modèle interne pour toutes les langues rencontrées, masquées comprises : sans lui,
    // retirer une rangée décalerait la langue masquée et ferait perdre ses mots-clés.
    var modele = {};
    (function () {
      var listes = opts.listes || {};
      for (var code in listes) {
        modele[code] = (listes[code] || []).map(function (x) {
          var v = String(x === undefined || x === null ? '' : x).trim();
          return estMarque(v) ? '' : v;
        });
      }
      for (var i = 0; i < langues.length; i++) { modele[langues[i].code] = modele[langues[i].code] || []; }
    })();

    function nbRangees() {
      var n = 0;
      for (var code in modele) { if (modele[code].length > n) { n = modele[code].length; } }
      return n;
    }
    function absorber() {
      if (corps) {
        var rangees = corps.querySelectorAll('.mc-rangee:not(.mc-entete)');
        for (var r = 0; r < rangees.length; r++) {
          for (var l = 0; l < langues.length; l++) {
            var champ = rangees[r].querySelector('[data-langue="' + langues[l].code + '"]');
            if (champ) { modele[langues[l].code][r] = champ.value.trim(); }
          }
        }
      }
      var n = nbRangees();
      for (var code in modele) {
        while (modele[code].length < n) { modele[code].push(''); }
        modele[code].length = n;
      }
      return n;
    }

    function colonnes() {
      var cols = ['1.6em'];
      for (var i = 0; i < langues.length; i++) { cols.push('minmax(5em, 1fr)'); }
      if (opts.edition) { cols.push('1.8em'); }
      return cols.join(' ');
    }

    function changer() { if (opts.onChange) { opts.onChange(); } }

    function cellule(rangee, langue, valeur) {
      if (langue.lecture) {
        var vue = document.createElement('span');
        vue.className = 'mc-lecture' + (valeur === '' ? ' mc-vide' : '');
        vue.textContent = valeur !== '' ? valeur : (textes.sansEquivalent || '–');
        rangee.appendChild(vue);
        return;
      }
      var i = document.createElement('input');
      i.type = 'text';
      i.dataset.langue = langue.code;
      i.value = valeur;
      // MARQUE reste la sentinelle écrite dans le YAML (estMarque) ; le champ vide affiche
      // un texte i18n envoyé par l'hôte, dans la langue de l'interface.
      i.placeholder = textes.aTraduire || MARQUE;
      i.setAttribute('aria-label',
        (textes.motCle || '{0}').split('{0}').join(langue.libelle) + ' ' +
        String(rangee.dataset.index ? Number(rangee.dataset.index) + 1 : ''));
      i.addEventListener('input', changer);
      rangee.appendChild(i);
    }

    function ajouterRangee(valeurs, index) {
      var rangee = document.createElement('div');
      rangee.className = 'mc-rangee';
      rangee.style.gridTemplateColumns = colonnes();
      rangee.dataset.index = String(index);
      var num = document.createElement('span');
      num.className = 'mc-num';
      num.textContent = String(index + 1);
      rangee.appendChild(num);
      for (var i = 0; i < langues.length; i++) {
        var v = valeurs[langues[i].code] || '';
        cellule(rangee, langues[i], estMarque(v) ? '' : v);
      }
      if (opts.edition) {
        var retirer = document.createElement('button');
        retirer.type = 'button';
        retirer.className = 'mc-retirer';
        retirer.textContent = '×';
        retirer.title = textes.retirer || '';
        // Le rang distingue les rangées : sans lui, un lecteur d'écran annonce autant de
        // « retirer » identiques que de mots-clés, sans dire lequel.
        retirer.setAttribute('aria-label', (textes.retirer || '') + ' ' + String(index + 1));
        retirer.addEventListener('click', function () {
          // On retire la rangée, donc le mot-clé dans toutes les langues, masquées
          // comprises : retirer « diagnostic » sans « Diagnose » décalerait tout le reste.
          absorber();
          var i = Number(rangee.dataset.index);
          for (var code in modele) { modele[code].splice(i, 1); }
          rendre();
          changer();
        });
        rangee.appendChild(retirer);
      }
      corps.appendChild(rangee);
    }

    function collecterBrut() {
      absorber();
      var res = {};
      for (var code in modele) { res[code] = modele[code].slice(); }
      return res;
    }

    function collecter() {
      var brut = collecterBrut();
      var res = {};
      for (var code in brut) {
        var liste = brut[code];
        var aQuelqueChose = liste.some(function (x) { return x !== ''; });
        res[code] = aQuelqueChose
          ? liste.map(function (x) { return x === '' ? MARQUE : x; })
          : [];
      }
      return res;
    }

    // Reconstruit le DOM depuis le modèle, sans le relire : après un ajout ou un retrait de
    // rangée, absorber() y remettrait l'ancien DOM encore à l'écran, et le retrait resterait
    // sans effet.
    function rendre() {
      element.textContent = '';
      corps = document.createElement('div');
      corps.className = 'mc';
      element.appendChild(corps);

      var entete = document.createElement('div');
      entete.className = 'mc-rangee mc-entete';
      entete.style.gridTemplateColumns = colonnes();
      var vide = document.createElement('span');
      vide.className = 'mc-num';
      vide.textContent = '0';
      entete.appendChild(vide);
      for (var i = 0; i < langues.length; i++) {
        var t = document.createElement('span');
        t.textContent = langues[i].libelle;
        entete.appendChild(t);
      }
      if (opts.edition) { entete.appendChild(document.createElement('span')); }
      corps.appendChild(entete);

      var n = nbRangees();
      for (var r = 0; r < n; r++) {
        var ligne = {};
        for (var k = 0; k < langues.length; k++) {
          ligne[langues[k].code] = (modele[langues[k].code] || [])[r] || '';
        }
        ajouterRangee(ligne, r);
      }

      if (opts.edition) {
        var pied = document.createElement('div');
        pied.className = 'mc-pied';
        var plus = document.createElement('button');
        plus.type = 'button';
        plus.textContent = textes.ajouter || '+';
        plus.addEventListener('click', function () {
          absorber();
          for (var code in modele) { modele[code].push(''); }
          rendre();
          var champs = corps.querySelectorAll('.mc-rangee:last-of-type input');
          if (champs.length) { champs[0].focus(); }
          changer();
        });
        pied.appendChild(plus);
        element.appendChild(pied);
      }

      // Crochet d'après-rendu : rendre() vient de reconstruire tout le DOM interne. Ce qui est
      // tenu hors du modèle (un marqueur recalculé à l'affichage) doit être reposé ici, sans
      // quoi il resterait sur des nœuds disparus. Un appel explicite, comme opts.onChange,
      // évite un MutationObserver qui devrait ignorer ses propres mutations.
      if (opts.surRendu) { opts.surRendu(); }
    }

    // Changement des colonnes affichées : là, au contraire, il faut relire l'écran
    // d'abord, pour ne pas perdre une frappe en cours.
    function reconstruire(nouvellesLangues) {
      absorber();
      if (nouvellesLangues) {
        langues = nouvellesLangues;
        for (var i = 0; i < langues.length; i++) { modele[langues[i].code] = modele[langues[i].code] || []; }
        absorber();
      }
      rendre();
    }

    // Permutation de deux langues : les listes s'échangent en entier, colonnes masquées
    // comprises (changement de langue d'un article, où les mots-clés suivent les titres).
    // L'écran est relu d'abord, pour la frappe en cours.
    function permuter(a, b) {
      absorber();
      var t = modele[a] || [];
      modele[a] = modele[b] || [];
      modele[b] = t;
      rendre();
    }

    rendre();
    return {
      element: element,
      collecter: collecter,
      collecterBrut: collecterBrut,
      reconstruire: function (l) { reconstruire(l); },
      permuter: permuter
    };
  }


  // ---- Choix fermé posé sur une carte ----
  //
  // Un intitulé, un <select>, une liste d'options fermée, et la valeur de la fiche quand
  // elle en déclare une. Sert à la langue de l'article et à sa licence. Le `for`/`id` est
  // apparié, pour que le lecteur d'écran dise de quel choix il s'agit ; la valeur est relue
  // par `select[data-cle=<cle>]`, comme le type d'article.
  //
  // opts.cle      nom du champ, qui devient le `data-cle` du <select>
  // opts.libelle  intitulé affiché
  // opts.options  [{ valeur, libelle }], dans l'ordre d'affichage
  // opts.valeur   valeur déclarée par la fiche, ou '' quand elle ne l'est pas
  // opts.defaut   valeur présélectionnée à défaut ; sinon la première option
  // opts.onChange appelé au changement
  //
  // Rend { label, select } ; l'appelant les insère où il veut dans sa carte. Les
  // identifiants viennent d'un compteur interne.
  var nChoixFerme = 0;

  function choixFerme(opts) {
    var options = opts.options || [];
    var valeurs = options.map(function (o) { return o.valeur; });
    var id = 'szh-choix-' + opts.cle + '-' + (++nChoixFerme);
    var defaut = valeurs.indexOf(opts.defaut) !== -1 ? opts.defaut
      : (valeurs.length > 0 ? valeurs[0] : '');
    var valeur = valeurs.indexOf(opts.valeur) !== -1 ? opts.valeur : defaut;

    var label = document.createElement('label');
    label.textContent = opts.libelle || '';
    label.setAttribute('for', id);
    var select = document.createElement('select');
    select.id = id;
    select.dataset.cle = opts.cle;
    for (var i = 0; i < options.length; i++) {
      var opt = document.createElement('option');
      opt.value = options[i].valeur;
      opt.textContent = options[i].libelle || options[i].valeur;
      select.appendChild(opt);
    }
    select.value = valeur;
    if (opts.onChange) {
      select.addEventListener('input', function () { opts.onChange(select.value); });
    }
    return { label: label, select: select };
  }

  // ---- Langue d'un article ----
  //
  // La langue vit dans la fiche <slug>.meta.yaml et prime, au rendu, sur celle du numéro :
  // elle décide de `<html lang>`, du `/Lang` du PDF, des libellés « Figure / Abbildung » et
  // de la langue dans laquelle les titres doivent exister. Choix fermé sur les trois
  // langues de la revue (pas d'anglais).
  //
  // Une fiche sans `lang` s'ouvre sur la langue du numéro, comme le repli de
  // szh-maquette.lua : le formulaire montre la langue qui s'imprimera. Le premier
  // enregistrement de la carte la rend explicite, et l'avertissement de compilation
  // disparaît.
  //
  // opts.valeur   langue déclarée dans la fiche, ou '' si elle ne l'est pas
  // opts.defaut   langue du numéro, présélectionnée à défaut
  // opts.textes   { libelle, fr, de, it }
  // opts.onChange appelé au changement
  //
  // Rend { label, select }, fabriqués par choixFerme ; cette fonction porte la liste des
  // langues et leurs noms.
  var LANGUES_CHOIX = ['fr', 'de', 'it'];

  function choixLangue(opts) {
    var textes = opts.textes || {};
    return choixFerme({
      cle: 'lang', libelle: textes.libelle,
      options: LANGUES_CHOIX.map(function (code) {
        return { valeur: code, libelle: textes[code] || code };
      }),
      valeur: opts.valeur, defaut: LANGUES_CHOIX.indexOf(opts.defaut) !== -1 ? opts.defaut : 'fr',
      onChange: opts.onChange
    });
  }

  // ---- L'écoute des messages de l'hôte, partagée ----
  //
  // Le socle écoute l'hôte pour son propre compte (le mode « Trad », plus bas) sans rien
  // demander aux pages. Il pose son écoute ici, une fois, et chaîne celle que chaque page
  // posera ensuite : une seule écoute réelle sur `window`, plusieurs destinataires, servis
  // dans l'ordre où ils se sont annoncés.
  //
  // Un destinataire qui rend `true` a consommé le message et arrête la chaîne : sinon les
  // pages afficheraient « type de message inconnu » pour les messages du socle.
  var ecouteursHote = [];
  var ecouteInstallee = false;
  var ajouterEcouteur = window.addEventListener.bind(window);

  function ecouterHote(fn) {
    ecouteursHote.push(fn);
    if (ecouteInstallee) { return; }
    ecouteInstallee = true;
    ajouterEcouteur('message', function (ev) {
      for (var i = 0; i < ecouteursHote.length; i++) {
        if (ecouteursHote[i].call(window, ev) === true) { return; }
      }
    });
  }

  window.addEventListener = function (type, fn, opts) {
    if (type === 'message' && typeof fn === 'function') { ecouterHote(fn); return; }
    return ajouterEcouteur(type, fn, opts);
  };

  // ---- Mode « Trad » : relire les libellés de l'outil là où ils s'affichent ----
  //
  // Activé dans les réglages, il détourne le clic : un clic sur n'importe quel texte d'un
  // panneau ouvre le formulaire de suggestion sur ce texte, au lieu de l'action habituelle.
  // Les libellés de l'outil, plus de mille, sont créés à des centaines d'endroits :
  // l'interception est écrite ici, une fois, pour toutes les pages.
  //
  // À distinguer de la pastille du vérificateur de traduction, qui sert les quatre champs
  // traduisibles d'un article. Les deux modes sont indépendants.
  //
  // Deux garde-fous :
  //   1. On peut toujours l'éteindre. Le formulaire de suggestion s'exclut lui-même
  //      (SZH.modeTradJamais, en tête de son script), et la barre d'onglets de l'Accueil et
  //      son onglet Paramètres sont exemptés (data-trad-exempt). Depuis tout panneau, on peut
  //      aussi sortir par le bouton du bandeau ou par Échap.
  //   2. Le mode se voit : tout panneau qui détourne ses clics pose un bandeau en tête de
  //      page.
  //
  // Protocole avec l'hôte :
  //   webview -> hôte : modeTrad (demande) ; modeTrad { actif: false } (extinction) ;
  //                     suggererInterface { texte, cles }
  //   hôte -> webview : modeTrad { actif, index, textes }
  var trad = {
    exclue: false, actif: false, demandee: false, branche: false,
    api: null, index: null, textes: {}, bandeau: null
  };

  function modeTradJamais() { trad.exclue = true; }

  // ---- Retrouver la clé du texte cliqué ----
  //
  // Même recherche que lib/index-textes.js, côté page : l'hôte envoie l'index une fois, et
  // on le consulte ici à chaque clic. test/js/mode-trad.test.js vérifie que les deux
  // rendent les mêmes clés.
  var RE_ESPACES_TRAD = /[\s   ]+/g;

  function normaliserTrad(texte) {
    return String(texte === undefined || texte === null ? '' : texte)
      .replace(RE_ESPACES_TRAD, ' ').trim();
  }

  // Chaque trou vaut au moins un caractère : sans cela « Volume {0} » reconnaîtrait
  // « Volume », qui est un autre libellé.
  function motifColleTrad(parts, texte) {
    if (!parts || parts.length < 2) { return false; }
    var debut = parts[0];
    if (texte.slice(0, debut.length) !== debut) { return false; }
    var pos = debut.length;
    for (var i = 1; i < parts.length - 1; i++) {
      var j = texte.indexOf(parts[i], pos + 1);
      if (j === -1) { return false; }
      pos = j + parts[i].length;
    }
    var fin = parts[parts.length - 1];
    if (fin !== '' && texte.slice(texte.length - fin.length) !== fin) { return false; }
    return texte.length - fin.length > pos;
  }

  function trouverClesTrad(texte) {
    var index = trad.index;
    var t = normaliserTrad(texte);
    if (!index || t === '') { return []; }
    var exact = index.exact || {};
    if (Object.prototype.hasOwnProperty.call(exact, t)) { return exact[t].slice(); }
    var sortie = [];
    var motifs = index.motifs || [];
    for (var i = 0; i < motifs.length; i++) {
      if (motifColleTrad(motifs[i].parts, t)) { sortie.push(motifs[i].cle); }
    }
    return sortie;
  }

  // ---- Le texte visé par un clic ----
  //
  // Le texte qu'un élément porte en propre, et non celui de tous ses descendants : sinon un
  // clic dans la marge rendrait le panneau entier.
  function texteEnPropre(e) {
    var enfants = e.childNodes || [];
    var propre = '';
    var elements = 0;
    for (var i = 0; i < enfants.length; i++) {
      if (enfants[i].nodeType === 3) { propre += enfants[i].nodeValue || ''; }
      else if (enfants[i].nodeType === 1) { elements++; }
    }
    propre = normaliserTrad(propre);
    // Sans descendant, le textContent est le texte propre.
    if (propre === '' && elements === 0) { propre = normaliserTrad(e.textContent); }
    return propre;
  }

  // Ces éléments portent un libellé d'un seul tenant : un bouton fait d'un pictogramme et
  // d'un mot n'a pas de texte en propre, et c'est son mot qu'on veut relire. Ailleurs, on
  // s'en tient au texte propre.
  var CONTROLES_TRAD = ['button', 'a', 'label', 'legend', 'option', 'summary', 'th', 'dt'];

  function valeurAttribut(e, prop, nom) {
    var v = prop && e[prop] !== undefined && e[prop] !== null ? e[prop] : '';
    if (String(v) === '' && e.getAttribute) { v = e.getAttribute(nom); }
    return normaliserTrad(v);
  }

  function texteDe(e) {
    var t = texteEnPropre(e);
    if (t !== '') { return t; }
    var balise = String(e.tagName || '').toLowerCase();
    if (CONTROLES_TRAD.indexOf(balise) !== -1) {
      t = normaliserTrad(e.textContent);
      if (t !== '') { return t; }
    }
    // Les textes qui ne sont dans aucun nœud de texte. `value` sur un bouton seulement : sur
    // un champ de saisie, ce serait la saisie du rédacteur.
    var type = String(e.type || '').toLowerCase();
    if (balise === 'button' || (balise === 'input' &&
        ['button', 'submit', 'reset'].indexOf(type) !== -1)) {
      t = valeurAttribut(e, 'value', 'value');
      if (t !== '') { return t; }
    }
    t = valeurAttribut(e, 'placeholder', 'placeholder');
    if (t !== '') { return t; }
    t = valeurAttribut(e, 'title', 'title');
    if (t !== '') { return t; }
    return valeurAttribut(e, null, 'aria-label');
  }

  // L'élément le plus proche qui porte un texte, en remontant depuis la cible du clic.
  function texteCliquable(depart) {
    var e = depart;
    var garde = 0;
    while (e && e.nodeType === 1 && garde < 40) {
      var t = texteDe(e);
      if (t !== '') { return t; }
      if (e === document.body) { return ''; }
      // Remonter d'un cran : `parentElement` dans le DOM, et des replis pour les DOM réduits
      // des tests, où le lien porte un autre nom.
      e = e.parentElement || e.parentNode || e.parent;
      garde++;
    }
    return '';
  }

  function dansBandeau(e) {
    if (!trad.bandeau || !e) { return false; }
    if (e === trad.bandeau) { return true; }
    return !!(e.closest && e.closest('.szh-trad-bandeau'));
  }

  // Une zone marquée data-trad-exempt garde ses clics quand le mode est actif : ce qui permet
  // de l'éteindre (réglages, barre d'onglets) reste utilisable.
  function exempteTrad(depart) {
    var e = depart;
    var garde = 0;
    while (e && e.nodeType === 1 && garde < 40) {
      if (e.dataset && e.dataset.tradExempt) { return true; }
      e = e.parentElement || e.parentNode || e.parent;
      garde++;
    }
    return false;
  }

  function surClicTrad(ev) {
    if (!trad.actif || trad.exclue) { return; }
    var cible = ev.target || null;
    // Le bandeau reste cliquable : c'est la sortie du mode.
    if (dansBandeau(cible) || exempteTrad(cible)) { return; }
    // On bloque le clic avant de savoir si un texte a été trouvé : sinon un clic dans la
    // marge d'un bouton ferait l'action normale alors que le bandeau annonce le contraire.
    if (ev.preventDefault) { ev.preventDefault(); }
    if (ev.stopPropagation) { ev.stopPropagation(); }
    var texte = texteCliquable(cible);
    if (texte === '' || !trad.api) { return; }
    trad.api.postMessage({
      type: SZH.MSG.SUGGERER_INTERFACE, texte: texte, cles: trouverClesTrad(texte)
    });
  }

  function surToucheTrad(ev) {
    if (!trad.actif || trad.exclue) { return; }
    if (ev.key !== 'Escape' && ev.key !== 'Esc') { return; }
    eteindreTrad();
  }

  // Éteindre depuis n'importe quel panneau : on éteint ici d'abord, pour que la page
  // redevienne cliquable sans attendre, puis on prévient l'hôte, qui écrit le réglage et
  // prévient les autres panneaux.
  function eteindreTrad() {
    appliquerTrad({ actif: false });
    if (trad.api) {
      try { trad.api.postMessage({ type: SZH.MSG.MODE_TRAD, actif: false }); }
      catch (e) { /* panneau déjà fermé */ }
    }
  }

  function poserBandeau() {
    if (trad.bandeau) { return; }
    var dit = document.createElement('span');
    dit.textContent = String(trad.textes.bandeau || '');
    var sortie = document.createElement('button');
    sortie.type = 'button';
    sortie.className = 'szh-bouton szh-trad-sortie';
    sortie.textContent = String(trad.textes.eteindre || '');
    sortie.addEventListener('click', function (ev) {
      if (ev && ev.stopPropagation) { ev.stopPropagation(); }
      eteindreTrad();
    });
    var p = notif('attention', [dit, sortie]);
    p.classList.add('szh-trad-bandeau');
    document.body.insertBefore(p, document.body.firstChild);
    trad.bandeau = p;
  }

  function retirerBandeau() {
    if (!trad.bandeau) { return; }
    if (trad.bandeau.remove) { trad.bandeau.remove(); }
    trad.bandeau = null;
  }

  function appliquerTrad(msg) {
    if (trad.exclue) { return; }
    trad.actif = msg.actif === true;
    if (msg.index) { trad.index = msg.index; }
    if (msg.textes) { trad.textes = msg.textes; }
    if (!trad.actif) { retirerBandeau(); return; }
    if (!trad.branche) {
      trad.branche = true;
      // En capture et sur <body> : la capture passe avant tout gestionnaire posé sur un
      // descendant, sans quoi le bouton aurait déjà agi.
      document.body.addEventListener('click', surClicTrad, true);
      document.body.addEventListener('keydown', surToucheTrad, true);
    }
    poserBandeau();
  }

  // L'index pèse des dizaines de kilo-octets : il n'est envoyé que si le mode est actif. La
  // page demande, l'hôte répond, ou non.
  //
  // La demande part avec le « pret » (voir annoncerPret), sans message propre : cela évite
  // un aller-retour à chaque ouverture de panneau et un message de plus dans le protocole
  // de chaque page.
  function demanderModeTrad(api) {
    if (trad.exclue || !api) { return false; }
    trad.demandee = true;
    trad.api = api;
    return true;
  }

  ecouterHote(function (ev) {
    var msg = (ev && ev.data) || {};
    if (msg.type !== SZH.MSG.MODE_TRAD) { return false; }
    appliquerTrad(msg);
    return true;
  });

  // ---- Annonce de la page ----
  //
  // L'hôte peut manquer le « pret » de la page s'il branche son écoute après avoir posé le
  // HTML ; le formulaire resterait alors vide. Les hôtes du cockpit écoutent avant de poser
  // le HTML ; cette relance couvre les autres cas. `recu` doit rendre vrai dès le premier
  // message reçu de l'hôte.
  //
  // Un jeton (`requete`), le même à chaque relance : sur un aller-retour lent, l'hôte peut
  // répondre deux fois à « pret », et la seconde « valeurs »/« charger » arriverait pendant
  // la saisie, qu'elle écraserait. L'hôte recopie ce jeton dans sa réponse ;
  // jetonDejaTraite() dit à la page laquelle traiter.
  function annoncerPret(api, recu) {
    var essais = 0;
    var requete = Date.now().toString(36) + Math.random().toString(36).slice(2);
    // Toutes les pages passent par ici avec leur api : c'est là que le socle peut parler à
    // l'hôte. `modeTrad` demande aussi l'état du mode « Trad » ; les pages qui s'en excluent
    // ne le portent pas, et l'hôte ne leur envoie pas l'index.
    var pret = { type: SZH.MSG.PRET, requete: requete };
    if (demanderModeTrad(api)) { pret.modeTrad = true; }
    api.postMessage(pret);
    var minuteur = setInterval(function () {
      essais++;
      if ((recu && recu()) || essais > 6) { clearInterval(minuteur); return; }
      api.postMessage(pret);
    }, 350);
    return requete;
  }

  // Course pret/valeurs : rend vrai si `msg` est un doublon à ignorer (même jeton qu'une
  // réponse déjà traitée), faux sinon, et retient alors ce jeton. `etat` est un objet
  // `{ jeton: null }` tenu par la page, un par formulaire. Une réponse sans jeton (un
  // rechargement déclenché par une action, pas par « pret ») n'est jamais un doublon. Un
  // rechargement forcé (`msg.rechargement === true` : fiche périmée, écrite ailleurs, ou
  // réponse à « demande-rechargement ») passe toujours, même sur un jeton déjà vu.
  function jetonDejaTraite(etat, msg) {
    if (msg.rechargement) { return false; }
    if (msg.requete === undefined || msg.requete === null) { return false; }
    if (etat.jeton === msg.requete) { return true; }
    etat.jeton = msg.requete;
    return false;
  }

  // ---- Barre de commandes ----
  //
  // Texte court et pictogramme : le texte dit ce que fait le bouton, le pictogramme le fait
  // reconnaître dans une barre qui en porte plusieurs. Un bouton vaut
  // { id, libelle, icone, tip, principal, danger, desactive, actif, groupe } et
  // `onAction(id)` est appelé au clic. `groupe` n'est pas lu ici : c'est un contrat entre
  // l'hôte et la page (articles.js, qui répartit ses boutons sur deux lignes). Rend la zone
  // d'état de la barre, où l'appelant écrit ce qu'il vient de faire.
  //
  // `opts.sansEtat` omet le pousse et la zone d'état (rend alors null) : une page à
  // plusieurs barres ne doit garder qu'une zone role="status", sinon un lecteur d'écran
  // annoncerait deux fois la même chose, ou rien.
  //
  // `actif` (booléen, absent sur un bouton ordinaire) fait du bouton un interrupteur :
  // aria-pressed est posé, et _design.css lui donne le fond plein. Allumé veut dire « ce que
  // ce bouton commande est à l'écran », comme dans le reste de l'éditeur. Le libellé d'un
  // interrupteur ne change pas avec son état (un bouton à bascule WAI-ARIA garde son nom,
  // seul aria-pressed change) ; l'infobulle dit l'action à venir.
  function boutonCommande(b, onAction) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'szh-bouton'
      + (b.principal ? ' szh-bouton--principal' : '')
      + (b.danger ? ' bouton-danger' : '');
    if (b.actif !== undefined && b.actif !== null) {
      el.setAttribute('aria-pressed', b.actif ? 'true' : 'false');
    }
    if (b.icone) { el.appendChild(icone(b.icone)); }
    var texte = document.createElement('span');
    texte.textContent = b.libelle || '';
    el.appendChild(texte);
    if (b.tip) { el.title = b.tip; }
    el.disabled = !!b.desactive;
    el.dataset.id = String(b.id || '');
    el.addEventListener('click', function () {
      if (onAction) { onAction(String(b.id || '')); }
    });
    return el;
  }

  function barreBoutons(conteneur, boutons, onAction, opts) {
    conteneur.textContent = '';
    for (var i = 0; i < (boutons || []).length; i++) {
      conteneur.appendChild(boutonCommande(boutons[i], onAction));
    }
    if ((opts || {}).sansEtat) { return null; }
    var pousse = document.createElement('span');
    pousse.className = 'szh-pousse';
    conteneur.appendChild(pousse);
    var etat = document.createElement('span');
    etat.className = 'szh-barre-etat';
    etat.setAttribute('role', 'status');
    conteneur.appendChild(etat);
    return etat;
  }

  // ---- Liste de cartes ----
  //
  // Une carte par élément, trois étages fixes : la tête et sa mesure, ce qu'il y a à lire,
  // puis les commandes et l'état, pour que deux cartes voisines se lisent de la même façon.
  //
  // Sert à toutes les vues d'ensemble (« Traductions », « Word en attente », « Articles »).
  // Une ligne vaut :
  //
  //   { cle, groupe, titre, meta, notif: { ton, texte },
  //     messages: [{ ton, texte, action,
  //                  titre, elements: [{ libelle, id, tip }], consigne, infobulle, pourquoi }],
  //     pastilles: [{ texte, ton, icone }], ouvrir,
  //     actions: [{ id, libelle, icone, tip, desactive, danger }],
  //     taches: [{ id, libelle, faite }],
  //     constats: [{ ton, texte }] }
  //
  // `messages` : plusieurs défauts dans une même carte, une phrase chacun, avec son action au
  // bout. La vue Contrôles tient ainsi un article par carte. `action` vaut une entrée de
  // `actions`, ou null quand rien n'est à faire ailleurs, et part par le même
  // opts.onAction(cle, id). Avec `titre`, le message se pose en quatre étages
  // (messageEnEtages) ; sans lui, la phrase `texte` et sa flèche.
  //
  // opts.conteneur   élément qui reçoit les cartes
  // opts.textes()    -> { ouvrir, listeVide }, relu à chaque rendu : la langue peut arriver après
  // opts.onOuvrir(cle) / opts.onAction(cle, id) / opts.onTache(cle, id, cochee)
  //
  // Rend { rendre, majPastilles, focaliser }. `focaliser(valeur)` amène à l'écran la carte
  // dont `cle` vaut `valeur` et la marque quelques secondes ; une carte sans `cle` ne porte
  // pas de [data-cle].
  function listeCartes(opts) {
    var conteneur = opts.conteneur;
    var lireTextes = opts.textes || function () { return {}; };
    // Les pieds de carte, par clé : on peut rafraîchir une seule pastille sans reconstruire
    // la liste. De même pour les compteurs de tâches : cocher une case ne repose que son
    // entête.
    var pieds = {};
    var compteurs = {};

    // Le compteur de l'entête « À faire », posé à la construction et reposé seul quand une
    // case est cochée. `resume` est { texte, toutes }, ou null quand la revue ne définit
    // aucune tâche (l'entête n'affiche alors que son titre).
    function poserCompteurTaches(compteur, resume) {
      compteur.textContent = resume ? (resume.texte || '') : '';
      compteur.classList.toggle('szh-taches-compteur--ok', !!(resume && resume.toutes));
    }

    // Ce qui reste à faire sur cette carte, dans un seul encadré : les tâches cochables, puis
    // ce que la carte signale (d'abord ce qui mérite un regard, ensuite ce qui arrêtera la
    // publication). Trois groupes, trois titres, un seul cadre.
    //
    // L'encadré n'existe que si l'un des trois groupes a quelque chose à montrer.
    //
    // -> { bloc, compteur } ; `compteur` est null quand la revue ne définit aucune tâche,
    // l'entête « À faire » n'étant alors pas posé.
    function poserAFaire(carte, ligne) {
      var taches = ligne.taches || [];
      var constats = ligne.constats || [];
      if (taches.length === 0 && constats.length === 0) { return null; }
      var mots = lireTextes() || {};
      var bloc = poser(carte, 'div', 'szh-taches');
      var compteur = null;
      if (taches.length > 0) {
        var entete = poser(bloc, 'div', 'szh-taches-entete');
        poser(entete, 'span', 'szh-taches-titre', mots.tachesEntete || '');
        compteur = poser(entete, 'span', 'szh-taches-compteur');
        poserCompteurTaches(compteur, ligne.tachesResume);
      }
      for (var i = 0; i < taches.length; i++) {
        (function (tache) {
          var l = poser(bloc, 'label', 'szh-tache');
          var case_ = document.createElement('input');
          case_.type = 'checkbox';
          case_.checked = !!tache.faite;
          case_.dataset.tache = String(tache.id || '');
          case_.addEventListener('change', function () {
            if (opts.onTache) { opts.onTache(String(ligne.cle || ''), String(tache.id || ''), !!case_.checked); }
          });
          l.appendChild(case_);
          poser(l, 'span', null, tache.libelle || '');
        }(taches[i]));
      }
      poserGroupeConstats(bloc, constats, 'attention', mots.constatsAttention);
      poserGroupeConstats(bloc, constats, 'danger', mots.constatsDanger);
      return { bloc: bloc, compteur: compteur };
    }

    // Un groupe de constats d'un même ton, titre compris ; rien quand aucun constat ne porte
    // ce ton.
    function poserGroupeConstats(bloc, constats, ton, titre) {
      var miens = [];
      for (var i = 0; i < constats.length; i++) {
        // Un ton inconnu retombe sur « attention » : un constat ne doit pas disparaître pour
        // un ton mal orthographié côté hôte.
        var mien = constats[i].ton === 'danger' ? 'danger' : 'attention';
        if (mien === ton) { miens.push(constats[i]); }
      }
      if (miens.length === 0) { return; }
      var groupe = poser(bloc, 'div', 'szh-constats szh-constats--' + ton);
      poser(groupe, 'p', 'szh-taches-titre szh-constats-titre', titre || '');
      for (var k = 0; k < miens.length; k++) {
        groupe.appendChild(notif(ton, miens[k].texte || ''));
      }
    }

    // Une phrase de défaut et, au bout, le bouton qui mène là où on le corrige. Le bouton est
    // dans le corps de la notification : il suit le dernier mot et se replie avec le texte.
    function messageAvecGeste(ligne, msg) {
      if (msg.titre) { return messageEnEtages(ligne, msg); }
      var contenu = [document.createTextNode(msg.texte || '')];
      var action = msg.action;
      if (action && action.id) {
        contenu.push(boutonIcone(action.icone || 'fleche',
          action.libelle || action.tip || '',
          (function (cle, id) {
            return function () { if (opts.onAction) { opts.onAction(cle, id); } };
          }(String(ligne.cle || ''), String(action.id || ''))),
          'szh-ico--enligne'));
      }
      return avecCroix(notif(msg.ton || 'info', contenu), msg);
    }

    // Un défaut de la vue « À corriger », en quatre étages (lib/constats.js, SECOND_ETAGE) :
    //
    //   2 images sans description  (i)          le titre, et le bouton qui explique
    //   fig-01.png →, fig-02.png →              un lien par objet en cause
    //   Ajoutez une description dans …          UNE phrase d'action
    //   [Ouvrir Médias de l'article →]          le bouton
    //
    // L'explication (pourquoi c'est un défaut, ce qui a été gardé, le repère ISO) est
    // l'infobulle du bouton (i) et de toute la boîte au survol ; le même bouton la déplie
    // sous le titre au clic ou au clavier (Entrée, Espace), une infobulle seule ne
    // s'atteignant pas sans souris. Le message garde `texte` (titre et consigne) : c'est lui
    // que l'hôte retient pour une croix fermée.
    var numeroPourquoi = 0;
    function messageEnEtages(ligne, msg) {
      var cle = String(ligne.cle || '');
      var agir = function (id) {
        return function () { if (opts.onAction) { opts.onAction(cle, String(id || '')); } };
      };
      var contenu = [];
      var tete = document.createElement('span');
      tete.className = 'szh-msg-titre';
      tete.appendChild(document.createTextNode(msg.titre));
      contenu.push(tete);
      var explication = null;
      if (msg.infobulle) {
        numeroPourquoi += 1;
        explication = document.createElement('span');
        explication.className = 'szh-msg-infobulle';
        explication.id = 'szh-pourquoi-' + numeroPourquoi;
        explication.hidden = true;
        explication.textContent = msg.infobulle;
        var pourquoi = document.createElement('button');
        pourquoi.type = 'button';
        pourquoi.className = 'szh-ico szh-ico--enligne szh-msg-pourquoi';
        pourquoi.title = msg.infobulle;
        pourquoi.setAttribute('aria-label', msg.pourquoi || '');
        pourquoi.setAttribute('aria-expanded', 'false');
        pourquoi.setAttribute('aria-controls', explication.id);
        pourquoi.appendChild(icone('info'));
        pourquoi.addEventListener('click', (function (bouton, zone) {
          return function () {
            var ouvrir = zone.hidden;
            zone.hidden = !ouvrir;
            bouton.setAttribute('aria-expanded', ouvrir ? 'true' : 'false');
          };
        }(pourquoi, explication)));
        tete.appendChild(pourquoi);
        contenu.push(explication);
      }
      var elements = msg.elements || [];
      if (elements.length > 0) {
        var objets = document.createElement('span');
        objets.className = 'szh-msg-objets';
        for (var i = 0; i < elements.length; i++) {
          if (i > 0) { objets.appendChild(document.createTextNode(', ')); }
          var lien = document.createElement('button');
          lien.type = 'button';
          lien.className = 'szh-lien-objet';
          if (elements[i].tip) { lien.title = elements[i].tip; }
          lien.dataset.id = String(elements[i].id || '');
          lien.appendChild(document.createTextNode(elements[i].libelle || ''));
          lien.appendChild(icone('fleche'));
          lien.addEventListener('click', agir(elements[i].id));
          objets.appendChild(lien);
        }
        contenu.push(objets);
      }
      if (msg.consigne) {
        var phrase = document.createElement('span');
        phrase.className = 'szh-msg-consigne';
        phrase.textContent = msg.consigne;
        contenu.push(phrase);
      }
      var action = msg.action;
      if (action && action.id) {
        var geste = document.createElement('span');
        geste.className = 'szh-msg-geste';
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'szh-bouton';
        if (action.tip) { b.title = action.tip; }
        b.dataset.id = String(action.id);
        b.appendChild(document.createTextNode(action.libelle || action.tip || ''));
        b.appendChild(icone('fleche'));
        b.addEventListener('click', agir(action.id));
        geste.appendChild(b);
        contenu.push(geste);
      }
      var boite = notif(msg.ton || 'info', contenu);
      boite.classList.add('szh-notif--etages');
      if (msg.infobulle) { boite.title = msg.infobulle; }
      return avecCroix(boite, msg);
    }

    function avecCroix(boite, msg) {
      // La croix, seulement là où l'hôte l'autorise (lib/constats.js, fermable). Elle est
      // hors du corps, contre le bord droit : elle ferme la boîte, sans rapport avec l'action
      // du défaut.
      if (msg.fermable && msg.empreinte) {
        var mots = lireTextes() || {};
        boite.appendChild(boutonIcone('croix', mots.fermerConstat || '',
          (function (empreinte, elem) {
            return function () {
              // Retirée tout de suite : l'hôte renverra la vue, mais le clic doit se voir sans
              // attendre.
              elem.remove();
              if (opts.onFermer) { opts.onFermer(empreinte); }
            };
          }(String(msg.empreinte), boite)),
          'szh-notif-croix'));
      }
      return boite;
    }

    // Les pastilles d'une carte, reposées seules, avec le compteur de son entête « À faire »
    // quand l'hôte l'envoie. Cocher une tâche ne reconstruit pas la liste : le clavier
    // perdrait le focus de la case, et deux clics rapprochés tomberaient sur un DOM en cours
    // de remplacement.
    function majPastilles(cle, pastilles, tachesResume) {
      var pied = pieds[String(cle)];
      if (pied) {
        var anciennes = pied.querySelectorAll('.szh-pastille');
        for (var i = 0; i < anciennes.length; i++) { pied.removeChild(anciennes[i]); }
        poserPastilles(pied, pastilles);
      }
      if (tachesResume !== undefined) {
        var compteur = compteurs[String(cle)];
        if (compteur) { poserCompteurTaches(compteur, tachesResume); }
      }
    }

    function poserPastilles(pied, pastilles) {
      for (var k = 0; k < (pastilles || []).length; k++) {
        var p = pastilles[k];
        var past = poser(pied, 'span', 'szh-pastille' + (p.ton ? ' szh-pastille--' + p.ton : ''));
        if (p.icone) { past.appendChild(icone(p.icone)); }
        poser(past, 'span', null, p.texte || '');
      }
    }

    function rendre(liste) {
      var mots = lireTextes() || {};
      conteneur.textContent = '';
      pieds = {};
      compteurs = {};
      liste = liste || [];
      if (liste.length === 0) {
        conteneur.appendChild(notif('info', mots.listeVide || ''));
        return;
      }
      var groupe = null;
      for (var i = 0; i < liste.length; i++) {
        var l = liste[i];
        if (l.groupe && l.groupe !== groupe) {
          groupe = l.groupe;
          poser(conteneur, 'h2', 'titre-section', groupe);
        }
        var carte = poser(conteneur, 'section', 'szh-carte ligne');
        // [data-cle] posé seulement quand la ligne porte une clé (le rapport de conversion
        // n'en a pas). C'est ce que focaliser() retrouve.
        if (l.cle) { carte.dataset.cle = String(l.cle); }
        var tete = poser(carte, 'header', 'szh-tete');
        poser(tete, 'p', 'szh-tete-nom', l.titre || '');
        if (l.meta) { poser(tete, 'span', 'szh-tete-meta', l.meta); }
        // Ce qui demande d'être lu (un commentaire, un message de conversion, une erreur)
        // est dans le corps de la carte, pas dans une infobulle.
        if (l.notif && l.notif.texte) {
          var corps = poser(carte, 'div', 'szh-corps');
          corps.appendChild(notif(l.notif.ton || 'info', l.notif.texte));
        }
        // Les défauts d'une carte groupée : l'action est au bout de la phrase, en flèche
        // étroite (.szh-ico--enligne, _liste.css), plutôt qu'un pied par défaut.
        var messages = l.messages || [];
        if (messages.length > 0) {
          var corpsM = poser(carte, 'div', 'szh-corps szh-messages');
          for (var m = 0; m < messages.length; m++) {
            corpsM.appendChild(messageAvecGeste(l, messages[m]));
          }
        }
        var aFaire = poserAFaire(carte, l);
        if (aFaire && aFaire.compteur) { compteurs[String(l.cle || '')] = aFaire.compteur; }
        var pied = poser(carte, 'footer', 'ligne-pied');
        pieds[String(l.cle || '')] = pied;
        if (l.ouvrir) {
          pied.appendChild(boutonCommande(
            { id: '', libelle: mots.ouvrir || '' },
            (function (cle) { return function () { if (opts.onOuvrir) { opts.onOuvrir(cle); } }; }(String(l.cle || '')))));
        }
        for (var a = 0; a < (l.actions || []).length; a++) {
          pied.appendChild(boutonCommande(l.actions[a],
            (function (cle) { return function (id) { if (opts.onAction) { opts.onAction(cle, id); } }; }(String(l.cle || '')))));
        }
        poserPastilles(pied, l.pastilles);
      }
    }

    // Amène une carte à l'écran et la marque quelques secondes, comme focaliserChamp() sur
    // un formulaire (_fiches.js) et focaliser() sur une figure (medias-article.js).
    //
    // `valeur` vide, ou sans [data-cle] correspondant : rien ne se passe. lib/constats.js
    // vise « word » avec des focus que toutes les cartes ne portent pas, et un fichier
    // réimporté peut avoir quitté la liste.
    var minuteurFocus = null;
    var carteFocalisee = null;
    function focaliser(valeur) {
      var v = String(valeur === undefined || valeur === null ? '' : valeur);
      if (minuteurFocus) { clearTimeout(minuteurFocus); minuteurFocus = null; }
      if (carteFocalisee) { carteFocalisee.classList.remove('szh-carte--focus'); carteFocalisee = null; }
      if (v === '') { return; }
      // Comparaison directe, sans sélecteur CSS construit avec `v` : un nom de fichier Word
      // porte des caractères (espaces, parenthèses, accents) qu'un sélecteur d'attribut ne
      // prend pas tous proprement. focaliserChamp() peut utiliser un sélecteur, ses clés
      // formant un jeu fermé.
      var carte = null;
      var candidates = conteneur.querySelectorAll('.szh-carte[data-cle]');
      for (var i = 0; i < candidates.length; i++) {
        if (candidates[i].dataset.cle === v) { carte = candidates[i]; break; }
      }
      if (!carte) { return; }
      try { carte.scrollIntoView({ block: 'center' }); } catch (e) { carte.scrollIntoView(); }
      carte.classList.add('szh-carte--focus');
      carteFocalisee = carte;
      minuteurFocus = setTimeout(function () {
        carte.classList.remove('szh-carte--focus');
        if (carteFocalisee === carte) { carteFocalisee = null; }
        minuteurFocus = null;
      }, 3000);
    }

    return { rendre: rendre, majPastilles: majPastilles, focaliser: focaliser };
  }

  // ---- Petits gestes de construction, partagés par plusieurs pages ----
  //
  // Un bouton texte, un bouton d'icône seule, une ligne aplatie (retours à la ligne rendus
  // en espace), un gabarit « {0} » substitué depuis une table de textes, et l'écriture
  // d'une zone d'état. Une page les reprend par un alias (`var bouton = SZH.bouton;`).
  function bouton(txt, fn, cls, titre) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = txt;
    b.className = 'szh-bouton' + (cls ? ' ' + cls : '');
    if (titre) { b.title = titre; }
    b.addEventListener('click', fn);
    return b;
  }
  function boutonIcone(nom, titre, fn, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'szh-ico' + (cls ? ' ' + cls : '');
    b.title = titre || '';
    b.setAttribute('aria-label', titre || '');
    b.appendChild(icone(nom));
    b.addEventListener('click', fn);
    return b;
  }
  function ligne(v) { return String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' ').trim(); }
  function remplir(txt, cle, valeurs) {
    var t = String((txt || {})[cle] || '');
    for (var i = 0; i < (valeurs || []).length; i++) { t = t.split('{' + i + '}').join(String(valeurs[i])); }
    return t;
  }
  function poserEtat(el, msg) { if (el) { el.textContent = msg || ''; } }

  // ---- Barre d'en-tête d'un formulaire pleine page ----
  //
  // La barre de documentation.js et de medias-article.js : bouton Enregistrer, bouton
  // Retour, indicateur de modification, zone d'état. Le message de « Retour » passe par
  // `opts.onRetour`, le compteur du gestionnaire des médias par `opts.avecCompte`.
  //
  // opts = { txt, onEnregistrer(), onRetour(), avecCompte, onApercu() }
  // Rend { enregistrer, indic, etat, compte?, apercu? } : les éléments que la page doit
  // garder. `onApercu` (facultatif, documentation.js) ajoute un interrupteur « Aperçu du
  // PDF » entre Enregistrer et Retour ; la page pose elle-même son aria-pressed
  // (majApercuBascule), car l'aperçu peut se fermer à la croix.
  function construireBarre(conteneur, opts) {
    var o = opts || {};
    var txt = o.txt || {};
    conteneur.textContent = '';
    conteneur.className = 'szh-barre';
    var ctl = {};
    ctl.enregistrer = bouton(txt.enregistrer, function () { if (o.onEnregistrer) { o.onEnregistrer(); } },
      'szh-bouton--principal', txt.enregistrerTip);
    conteneur.appendChild(ctl.enregistrer);
    if (o.onApercu) {
      ctl.apercu = bouton(txt.apercu, function () { o.onApercu(); }, 'szh-bouton--bascule', txt.apercuTip);
      ctl.apercu.setAttribute('aria-pressed', 'false');
      conteneur.appendChild(ctl.apercu);
    }
    conteneur.appendChild(bouton(txt.retour, function () { if (o.onRetour) { o.onRetour(); } }, '', txt.retourTip));
    ctl.indic = poser(conteneur, 'span', 'szh-barre-indic');
    ctl.indic.setAttribute('aria-live', 'polite');
    ctl.etat = poser(conteneur, 'span', 'szh-barre-etat');
    ctl.etat.setAttribute('role', 'status');
    if (o.avecCompte) {
      poser(conteneur, 'span', 'szh-pousse');
      ctl.compte = poser(conteneur, 'span', 'szh-barre-etat');
    }
    return ctl;
  }

  // ---- Plafonds d'image ----
  //
  // Deux profils : une figure d'article (50 Mo, les formats du pipeline y compris le SVG)
  // et une photo d'auteur·e (20 Mo, sans SVG ni GIF, avec le WebP). Ces valeurs sont un
  // repli : le message de chargement de chaque webview porte `limites` (lib/medias.js et
  // les constantes photo d'extension.js, qui font foi), et appliquerLimites() les pose ici.
  var LIMITES = {
    image: { maxi: 50 * 1024 * 1024, extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg'] },
    photo: { maxi: 20 * 1024 * 1024, extensions: ['png', 'jpg', 'jpeg', 'webp'] }
  };

  // `limites` = { imageMax, imageExtensions, photoMax, photoExtensions }. Absent, les valeurs
  // ci-dessus restent en place (utile aux tests qui postent un message minimal). Une clé
  // manquante laisse sa valeur par défaut.
  function appliquerLimites(limites) {
    if (!limites) { return; }
    if (limites.imageMax !== undefined) { LIMITES.image.maxi = limites.imageMax; }
    if (limites.imageExtensions !== undefined) { LIMITES.image.extensions = limites.imageExtensions; }
    if (limites.photoMax !== undefined) { LIMITES.photo.maxi = limites.photoMax; }
    if (limites.photoExtensions !== undefined) { LIMITES.photo.extensions = limites.photoExtensions; }
  }

  // ---- Moteur d'autocomplétion partagé (noms d'auteur·e·s, mots-clés edudoc.ch) ----
  //
  // Plie casse et accents pour chercher « commence par ce mot ». `plier()` retire les
  // espaces de bord, et les séparateurs de mot incluent la virgule et le point-virgule, qui
  // séparent les descripteurs d'un thésaurus (« troubles, difficultés »).
  var SEPARE_MOT = /[\s\-'’.,;]/;

  // Casse et accents pliés, sans le détail des positions : sert à comparer deux noms
  // (tri alphabétique), pas à chercher dans un texte.
  function plier(t) {
    var s = String(t === undefined || t === null ? '' : t).toLowerCase().replace(/\s+/g, ' ').trim();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }
    catch (e) { /* moteur sans normalize : filtrage sensible aux accents, sans casser */ }
    return s;
  }

  // Plie un texte et garde, pour chaque caractère du plié, l'indice du caractère d'origine :
  // sans cette table, mettre en gras la part trouvée obligerait à découper l'original aux
  // indices du plié, qui se décalent sur les caractères dont le repli Unicode change la
  // longueur (« İ », par exemple).
  function plierAvecIndex(brut) {
    var src = String(brut === undefined || brut === null ? '' : brut);
    var plie = '';
    var index = [];
    for (var i = 0; i < src.length; i++) {
      var c = src.charAt(i).toLowerCase();
      try { c = c.normalize('NFD').replace(/[̀-ͯ]/g, ''); }
      catch (e) { /* moteur sans normalize */ }
      for (var j = 0; j < c.length; j++) { plie += c.charAt(j); index.push(i); }
    }
    return { source: src, plie: plie, index: index };
  }

  // Les indices, dans le plié, où commence un mot : espace, trait d'union, apostrophes,
  // point d'initiale, virgule et point-virgule séparent deux mots.
  function debutsDeMot(plie) {
    var debuts = [];
    for (var i = 0; i < plie.length; i++) {
      if (SEPARE_MOT.test(plie.charAt(i))) { continue; }
      if (i === 0 || SEPARE_MOT.test(plie.charAt(i - 1))) { debuts.push(i); }
    }
    return debuts;
  }

  // Le premier début de mot à partir duquel `q` se lit tel quel, ou -1.
  function chercherDebut(pli, debuts, q) {
    for (var i = 0; i < debuts.length; i++) {
      if (pli.plie.lastIndexOf(q, debuts[i]) === debuts[i]) { return debuts[i]; }
    }
    return -1;
  }

  // Pose un texte dans `parent`, les parts trouvées en gras. `zones` est une liste de
  // [début, longueur] en indices du plié ; la table d'index les ramène sur l'original.
  // Rien n'est construit en HTML : un nom ou un descripteur est une donnée.
  function poserAvecGras(parent, pli, zones) {
    var brut = pli.source;
    var pose = 0;
    for (var z = 0; z < zones.length; z++) {
      var i0 = pli.index[zones[z][0]];
      var fin = zones[z][0] + zones[z][1];
      var i1 = (fin < pli.index.length) ? pli.index[fin] : brut.length;
      if (i0 < pose) { continue; }             // zones qui se recouvrent : la première gagne
      if (i0 > pose) { parent.appendChild(document.createTextNode(brut.slice(pose, i0))); }
      var fort = document.createElement('strong');
      fort.textContent = brut.slice(i0, i1);
      parent.appendChild(fort);
      pose = i1;
    }
    if (pose < brut.length) { parent.appendChild(document.createTextNode(brut.slice(pose))); }
  }

  // ---- Zone de dépôt : le motif complet, posé une fois ----
  //
  // Input file caché, bouton « Choisir un fichier » et glisser-déposer, sur un cadre
  // `.szh-depot` (survol : `.szh-depot.survol`, _design.css). `opts.surFichier(fichier)`
  // reçoit le File choisi ou déposé ; l'appelant le valide et le lit (voir `SZH.lireBase64`).
  //
  // opts.parent, opts.libelle, opts.icone ('camera' par défaut), opts.tip,
  // opts.extensions (liste, sans le point), opts.texteChoisir, opts.texteOu (facultatif,
  // « ou » entre le glisser-déposer et le bouton, comme la modale des auteur·e·s)
  // Rend { element, titre, choisir, fichier, etat } : `etat` est un span vide, à
  // l'appelant d'y écrire ce qu'il veut ; poserEtat() le fait proprement.
  function construireDepot(opts) {
    var o = opts || {};
    var d = poser(o.parent, 'div', 'szh-depot');
    if (o.tip) { d.title = o.tip; }
    // Icône et libellé facultatifs : une zone qui n'en reçoit pas n'en affiche pas.
    var titre = poser(d, 'span', 'szh-depot-titre');
    if (o.icone) { titre.appendChild(icone(o.icone)); }
    if (o.libelle) { poser(titre, 'span', null, o.libelle); }
    if (o.texteOu) { poser(d, 'span', 'ou', o.texteOu); }
    var choisir = bouton(o.texteChoisir || '', function () { fichier.click(); });
    d.appendChild(choisir);
    var fichier = document.createElement('input');
    fichier.type = 'file';
    fichier.accept = (o.extensions || []).map(function (e) { return '.' + e; }).join(',');
    fichier.hidden = true;
    d.appendChild(fichier);
    var surFichier = o.surFichier || function () {};
    fichier.addEventListener('change', function () {
      if (fichier.files && fichier.files[0]) { surFichier(fichier.files[0]); }
      fichier.value = '';
    });
    d.addEventListener('dragover', function (ev) { ev.preventDefault(); d.classList.add('survol'); });
    d.addEventListener('dragleave', function () { d.classList.remove('survol'); });
    d.addEventListener('drop', function (ev) {
      ev.preventDefault();
      d.classList.remove('survol');
      var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) { surFichier(f); }
    });
    // « alert » et non « status » : cette zone porte le sort d'un dépôt (en cours, refusé,
    // réussi), qui mérite d'interrompre la lecture, contrairement à la barre d'état générale.
    var etat = poser(d, 'span', 'szh-depot-etat');
    etat.setAttribute('role', 'alert');
    return { element: d, titre: titre, choisir: choisir, fichier: fichier, etat: etat };
  }

  // Lecture d'un fichier en base64. Formats et poids sont vérifiés ici pour répondre tout
  // de suite, et revérifiés par l'hôte.
  //
  // opts.extensions, opts.maxi (octets), opts.surDonnees(fichier, base64),
  // opts.surErreur(message), opts.surLecture() (facultatif, appelé avant la lecture)
  function lireBase64(fichier, opts) {
    var o = opts || {};
    var surErreur = o.surErreur || function () {};
    var ext = (String(fichier.name || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
    if ((o.extensions || []).indexOf(ext) === -1) { surErreur(o.msgFormat || ''); return; }
    if (o.maxi && fichier.size > o.maxi) { surErreur(o.msgPoids || ''); return; }
    if (o.surLecture) { o.surLecture(); }
    var lecteur = new FileReader();
    lecteur.onerror = function () { surErreur(o.msgFormat || ''); };
    lecteur.onload = function () {
      var t = String(lecteur.result || '');
      var virgule = t.indexOf(',');
      if (virgule === -1) { surErreur(o.msgFormat || ''); return; }
      if (o.surDonnees) { o.surDonnees(fichier, t.slice(virgule + 1)); }
    };
    lecteur.readAsDataURL(fichier);
  }

  // ---- Un textarea à la hauteur de son texte ----
  //
  // La zone prend la hauteur de son texte, jusqu'au plafond au-delà duquel elle défile
  // elle-même. Une hauteur tirée au coin l'emporte : la frappe suivante ne la reprend pas.
  // Une zone cachée ou détachée n'a pas de boîte (scrollHeight 0) : on n'y touche pas, et
  // suivreHauteur la mesure quand elle prend une largeur.
  var HAUTEUR_MAX = 480;
  function ajusterHauteur(zone, plafond) {
    if (zone.dataset.hauteurTiree === '1') { return; }
    if (zone.dataset.hauteurPosee && zone.style.height && zone.style.height !== zone.dataset.hauteurPosee) {
      zone.dataset.hauteurTiree = '1'; zone.style.overflowY = 'auto'; return;
    }
    if (typeof zone.getClientRects !== 'function' || zone.getClientRects().length === 0) { return; }
    var max = plafond > 0 ? plafond : HAUTEUR_MAX;
    // Replier la zone pour la mesurer raccourcit un instant la page : les ascenseurs
    // au-dessus d'elle reprennent ensuite leur position.
    var defiles = [];
    for (var p = zone.parentElement; p; p = p.parentElement) {
      if (p.scrollTop > 0) { defiles.push([p, p.scrollTop]); }
    }
    zone.style.height = 'auto';
    var h = zone.scrollHeight;
    if (h > 0) {
      // scrollHeight compte le remplissage, pas la bordure : `height` suit box-sizing.
      var cs = typeof getComputedStyle === 'function' ? getComputedStyle(zone) : null;
      if (cs && cs.boxSizing === 'border-box') {
        h += (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      } else if (cs) {
        h -= (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      }
      zone.style.height = Math.min(Math.ceil(h), max) + 'px';
      zone.dataset.hauteurPosee = zone.style.height;
      zone.style.overflowY = h > max ? 'auto' : 'hidden';
    }
    defiles.forEach(function (x) { x[0].scrollTop = x[1]; });
  }
  // Branche une zone : mesure à la saisie et chaque fois que sa largeur change (elle
  // devient visible, la fenêtre s'élargit). `plafond` est un nombre ou une fonction qui le
  // rend, relue à chaque mesure. Rend la fonction de mesure, pour une valeur posée par code.
  function suivreHauteur(zone, plafond) {
    var ajuster = function () { ajusterHauteur(zone, typeof plafond === 'function' ? plafond() : plafond); };
    zone.addEventListener('input', ajuster);
    if (typeof ResizeObserver === 'function') {
      var largeur = 0;
      new ResizeObserver(function (entrees) {
        var e = entrees && entrees[entrees.length - 1];
        var l = e && e.contentRect ? e.contentRect.width : 0;
        if (l === largeur) { return; }
        largeur = l;
        if (l > 0) { ajuster(); }
      }).observe(zone);
    }
    ajuster();
    return ajuster;
  }

  return {
    autoEnregistrement: autoEnregistrement, motsCles: motsCles,
    choixFerme: choixFerme, choixLangue: choixLangue,
    annoncerPret: annoncerPret, jetonDejaTraite: jetonDejaTraite,
    modeTradJamais: modeTradJamais,
    icone: icone, notif: notif, poserAccent: poserAccent,
    barreBoutons: barreBoutons, boutonCommande: boutonCommande, listeCartes: listeCartes,
    poser: poser, modale: modale, LANGUES_CHOIX: LANGUES_CHOIX,
    MARQUE_A_TRADUIRE: MARQUE,
    bouton: bouton, boutonIcone: boutonIcone, ligne: ligne, remplir: remplir,
    poserEtat: poserEtat, construireBarre: construireBarre, LIMITES: LIMITES,
    appliquerLimites: appliquerLimites,
    plier: plier, plierAvecIndex: plierAvecIndex, debutsDeMot: debutsDeMot,
    chercherDebut: chercherDebut, poserAvecGras: poserAvecGras,
    construireDepot: construireDepot, lireBase64: lireBase64,
    ajusterHauteur: ajusterHauteur, suivreHauteur: suivreHauteur
  };
})();
