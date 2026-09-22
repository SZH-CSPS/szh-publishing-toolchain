// Socle commun des webviews, injecté par construireHtml avant le script de la page.
// Sans dépendance ni accès réseau : rien que du DOM.
//
//   SZH.autoEnregistrement(opts)  enregistrement automatique, sans voler le curseur
//   SZH.motsCles(opts)            éditeur de mots-clés appariés, partagé par les trois
//                                 formulaires qui touchent aux mots-clés
//   SZH.choixFerme(opts)          un intitulé et un <select> à liste fermée, sur une carte
//   SZH.choixLangue(opts)         le <select> de la langue d'un article, posé sur sa carte
//   SZH.annoncerPret(api, recu)   « pret », redemandé tant que l'hôte se tait
//   SZH.modeTradJamais()          cette page ne détourne JAMAIS ses clics (mode « Trad »)
//   SZH.icone(nom)                une icône de 16 px, dessinée en SVG
//   SZH.notif(ton, contenu)       une notification : info, ok, attention, danger
//   SZH.poser(parent, balise, …)  créer, classer, remplir, insérer : le geste de base
//   SZH.modale(opts)              le voile, la boîte, Échap et le retour du focus
//   SZH.poserAccent(hex)          la couleur annuelle du numéro devient l'accent
//   SZH.barreBoutons(...)         la barre de commandes d'une vue, et sa zone d'état
//   SZH.listeCartes(opts)         la liste de cartes des vues d'ensemble
var SZH = (function () {
  'use strict';

  // ---- Icônes ----
  //
  // Un jeu minimal, dessiné en SVG plutôt qu'en caractères : une icône doit suivre la
  // couleur du texte (`currentColor`) et rester nette à toutes les échelles. Chaque dessin
  // est une liste de primitives [balise, attributs] — des cercles et des rectangles quand
  // c'est possible, un tracé quand il le faut : une longue donnée de path se relit mal et
  // se corrige encore plus mal.
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
    // Fermer un message : deux traits nus. Jamais un cercle autour — ce serait l'icône
    // `danger`, et la croix qui efface se lirait comme la croix qui alarme.
    croix: [['path', { d: 'M4.3 4.3 11.7 11.7M11.7 4.3 4.3 11.7', fill: 'none',
      stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round' }]],
    // Ajouter : deux barres, rien de plus. Le libellé du bouton dit quoi.
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
    // Déplier : un chevron, sans hampe — une flèche se lirait « télécharger ».
    chevron: [['path', { d: 'M8 10.6 3.3 5.9l1.06-1.06L8 8.48l3.64-3.64L12.7 5.9 8 10.6z' }]],
    oeil: [
      ['path', { d: 'M8 3.25C4.7 3.25 2 5.15 1.15 8 2 10.85 4.7 12.75 8 12.75s6-1.9 6.85-4.75C14 5.15 11.3 3.25 8 3.25zm0 1.5c2.4 0 4.4 1.3 5.25 3.25C12.4 9.95 10.4 11.25 8 11.25S3.6 9.95 2.75 8C3.6 6.05 5.6 4.75 8 4.75z' }],
      ['circle', { cx: '8', cy: '8', r: '1.9' }]
    ],
    // L'oeil ferme : une paupiere baissee et trois cils, jamais un oeil barre d'un trait.
    // A 14 px le trait oblique se superpose au dessin plein de `oeil` et les deux etats
    // deviennent une tache indistincte ; la paupiere, elle, change la SILHOUETTE, ce qui se
    // lit du coin de l'oeil. Les cils partent de la courbe elle-meme (t = .25, .5, .75).
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
    // Imprimer : le corps et la feuille, tous deux en contour (CONTOUR), comme ses voisines
    // de la barre. Un premier essai à trois rectangles PLEINS se fondait en un seul bloc
    // noir à 14 px (comparé rendu contre rendu, tmp/apercu-articles/) ; un second à un seul
    // rectangle plein pour la feuille détonnait encore parmi des icônes en trait. Deux
    // rectangles en contour, l'un posé sur l'autre, suffisent à lire « corps » et « feuille »
    // sans jamais fondre en un pâté.
    imprimante: [
      ['rect', Object.assign({ x: '2', y: '6', width: '12', height: '6', rx: '1' }, CONTOUR)],
      ['rect', Object.assign({ x: '5', y: '2', width: '6', height: '4.5' }, CONTOUR)]
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
  // Créer, classer, remplir, insérer : quatre lignes qui revenaient dans chaque page. Une
  // seule implémentation, sur SZH, à côté d'icone et de notif.
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
  // d'où l'on vient — sans quoi le clavier repartirait du haut de la page. Le style vit
  // dans _design.css (.szh-modale, .szh-modale-boite, .szh-modale-pied) ; la boîte prend
  // la classe que l'appelant lui donne.
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
      // Cliquer à côté referme, comme dans toute visionneuse ; Échap aussi, comme dans
      // toute boîte de dialogue — et c'est la seule sortie au clavier.
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
  // La couleur annuelle lue dans ausgabe.yaml, que le socle (_design.css) reprend comme
  // accent. Validée avant d'entrer dans une propriété CSS : une valeur venue de l'hôte
  // n'entre jamais telle quelle dans une feuille de style.
  function poserAccent(hex) {
    var valide = /^#[0-9A-Fa-f]{6}$/.test(String(hex || ''));
    try {
      // Retirer la propriété quand l'hôte n'envoie rien : le numéro peut avoir perdu sa
      // couleur, et le panneau se recharge sans être refermé. Sans cela l'ancienne teinte
      // resterait accrochée à la racine.
      if (valide) { document.documentElement.style.setProperty('--szh-accent', hex); }
      else { document.documentElement.style.removeProperty('--szh-accent'); }
    } catch (e) { /* pas de racine stylable : le socle garde sa couleur de repli */ }
  }

  // ---- Notifications ----
  //
  // Un seul objet pour tous les messages du cockpit, et le ton dit la nature : `info` pour
  // ce qui explique, `ok` pour ce qui a réussi, `attention` pour ce qui mérite un regard,
  // `danger` pour ce qui ne passera pas la publication. Le style vit dans _design.css.
  // `contenu` est un texte, ou une liste de nœuds quand le message porte de la mise en
  // forme ; jamais de HTML injecté.
  function notif(ton, contenu, opts) {
    var o = opts || {};
    var p = document.createElement('p');
    p.className = 'szh-notif szh-notif--' + ton + (o.discret ? ' szh-notif--discret' : '');
    // La variante discrète n'a pas de pictogramme : elle sert aussi écrite à la main dans
    // le HTML d'une page, où il n'y a pas de SVG à poser — les deux doivent se ressembler.
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
  // Trois déclencheurs : un délai après la dernière frappe, et non un enregistrement
  // périodique, pour ne pas écrire au milieu d'un mot ; la perte de focus ou le changement
  // d'un champ ; et la perte de focus de la webview entière ou son passage en
  // arrière-plan, dernier rempart avant que VS Code ne détruise le DOM, ces panneaux
  // n'ayant pas `retainContextWhenHidden`. L'hôte répond sans renvoyer les valeurs quand
  // la demande est automatique, ce qui évite un re-rendu sous les doigts.
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
      // « change » en phase de remontée, et non en capture : le gestionnaire de la cible
      // doit avoir marqué sa modification avant qu'on décide d'écrire, sans quoi le
      // changement d'un choix ne déclenche rien.
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
  // cette grille, une rangée par mot-clé et une colonne par langue, dont l'ordre n'est pas
  // modifiable à la souris ; on ajoute ou on retire une rangée entière, jamais un mot dans
  // une seule langue, et l'appariement reste juste par construction. Une case laissée vide
  // s'écrit avec la marque plutôt que vide, sans quoi la valeur disparaîtrait à la
  // sérialisation et tout ce qui suit remonterait d'un cran.
  //
  // opts.langues  [{ code, libelle, lecture }]  lecture:true = colonne non éditable
  // opts.listes   { fr:[…], de:[…] }            valeurs de départ
  // opts.textes   { motCle, sansEquivalent, ajouter, retirer }
  // opts.edition  rangées ajoutables et retirables, ou structure figée pour le panneau de
  //               traduction, où l'on traduit sans inventer de mots-clés
  // opts.onChange appelé à chaque frappe et à chaque ajout ou retrait de rangée
  // opts.surRendu appelé à la fin de rendre(), une fois le DOM interne (re)construit — pour
  //               qui doit reposer, après coup, quelque chose que rendre() vient d'effacer
  //               (_fiches.js s'en sert pour la pastille « hors thésaurus », jamais tenue
  //               dans le modèle)
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
      '.mc-rangee .mc-num { color: var(--vscode-descriptionForeground); font-size: .85em; text-align: right; }',
      '.mc-entete { font-weight: 600; font-size: .85em; color: var(--vscode-descriptionForeground); }',
      '.mc-entete .mc-num { visibility: hidden; }',
      '.mc-lecture { padding: .25em .45em; border-radius: 2px; overflow-wrap: anywhere;',
      '  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.1));',
      '  border: 1px dashed var(--vscode-panel-border, rgba(128,128,128,.4)); }',
      '.mc-lecture.mc-vide { color: var(--vscode-descriptionForeground); font-style: italic; border-style: dotted; }',
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
    // Modèle interne pour toutes les langues rencontrées, y compris celles qui ne sont pas
    // affichées : sans lui, retirer une rangée décalerait la langue masquée et le
    // formulaire perdrait ses mots-clés italiens dès qu'on toucherait aux autres.
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
      // MARQUE reste la sentinelle écrite dans le YAML (estMarque, ci-dessus) : ce que le
      // champ vide affiche vient d'une clé i18n envoyée par l'hôte, dans la langue de
      // l'interface — jamais l'anglais figé de la sentinelle.
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

    // ⚠ Reconstruit le DOM depuis le modèle, sans jamais le relire : après un ajout ou un
    // retrait de rangée, absorber() y remettrait l'ancien DOM, encore à l'écran, et le
    // retrait resterait sans effet.
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

      // Crochet d'après-rendu : rendre() vient d'effacer et de reconstruire tout le DOM
      // interne (voir son commentaire plus haut) — quiconque tenait quelque chose EN DEHORS
      // du modèle (un marqueur, jamais persisté, recalculé à l'affichage) doit le reposer
      // maintenant, sans quoi il resterait accroché à des noeuds qui viennent de disparaître.
      // Un MutationObserver aurait pu jouer ce rôle sans exposer ce crochet, mais il aurait
      // fallu ignorer ses propres mutations pour ne pas boucler et deviner quand le DOM est
      // stable ; un appel explicite, en fin de rendre(), sur le modèle d'opts.onChange déjà
      // là, est plus direct et ne dépend d'aucune API du navigateur hôte.
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
    // comprises — c'est le geste du changement de langue d'un article, où les mots-clés
    // suivent les titres. L'écran est relu d'abord, pour la frappe en cours.
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
  // elle en déclare une. Deux champs s'en servent : la langue de l'article et sa licence.
  // Le `for`/`id` est apparié — sans lui, un lecteur d'écran annonce un choix sans dire
  // lequel — et la valeur est relue par `select[data-cle=<cle>]`, comme le type d'article.
  //
  // opts.cle      nom du champ, qui devient le `data-cle` du <select>
  // opts.libelle  intitulé affiché
  // opts.options  [{ valeur, libelle }], dans l'ordre d'affichage
  // opts.valeur   valeur déclarée par la fiche, ou '' quand elle ne l'est pas
  // opts.defaut   valeur présélectionnée à défaut ; sinon la première option
  // opts.onChange appelé au changement
  //
  // Rend { label, select } : c'est l'appelant qui les insère où il veut dans sa carte.
  // Le compteur d'identifiants évite d'en exiger un de l'appelant, qui construit une
  // carte par article.
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
  // c'est elle qui décide de `<html lang>`, du `/Lang` du PDF, des libellés « Figure /
  // Abbildung » et de la langue dans laquelle les titres doivent exister. Un choix fermé,
  // donc, sur les trois langues de la revue — l'anglais n'a pas de maquette.
  //
  // Une fiche sans `lang` s'ouvre sur la langue du numéro, exactement le repli que fait
  // szh-maquette.lua : le formulaire ne doit jamais montrer une autre langue que celle qui
  // s'imprimera. Le premier enregistrement de la carte la rend explicite, et
  // l'avertissement de compilation s'éteint.
  //
  // opts.valeur   langue déclarée dans la fiche, ou '' si elle ne l'est pas
  // opts.defaut   langue du numéro, présélectionnée à défaut
  // opts.textes   { libelle, fr, de, it }
  // opts.onChange appelé au changement
  //
  // Rend { label, select } : c'est choixFerme qui les fabrique, cette fonction ne portant
  // plus que la liste fermée des langues et leurs noms.
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
  // Le socle doit entendre l'hôte pour son propre compte — le mode « Trad », plus bas —
  // sans rien demander aux pages : elles sont douze, et la treizième oublierait la ligne de
  // relais. Il pose donc son écoute ici, une fois, et chaîne celle que chaque page posera
  // ensuite : une seule écoute réelle sur `window`, plusieurs destinataires, servis dans
  // l'ordre où ils se sont annoncés.
  //
  // Un destinataire qui rend `true` a CONSOMMÉ le message et arrête la chaîne : les
  // messages du socle ne sont pas ceux de la page, et les lui passer ferait crier « type de
  // message inconnu » dans chacune des pages qui surveillent leur protocole.
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
  // Allumé dans les réglages, il détourne le clic : au lieu de faire ce que le bouton fait
  // d'habitude, un clic sur n'importe quel texte d'un panneau ouvre le formulaire de
  // suggestion sur CE texte-là. C'est la seule façon de relire les libellés de l'outil là
  // où ils s'affichent : ils sont plus de mille, créés à des centaines d'endroits, et les
  // marquer un par un serait intenable — le prochain bouton ajouté oublierait sa marque.
  // L'interception est donc écrite ICI, une fois, et vaut pour toutes les pages.
  //
  // À ne pas confondre avec la pastille du vérificateur de traduction : celle-ci sert les
  // quatre champs traduisibles d'un ARTICLE et passe par une seule fonction. Les deux modes
  // sont indépendants et peuvent être allumés en même temps.
  //
  // DEUX GARDE-FOUS, sans lesquels le mode serait un piège.
  //   1. On doit TOUJOURS pouvoir l'éteindre. La page des réglages et le formulaire de
  //      suggestion s'excluent eux-mêmes (SZH.modeTradJamais, en tête de leur script) :
  //      sans cela on allumerait le mode sans plus pouvoir l'éteindre, et « Enregistrer »
  //      deviendrait inatteignable. S'y ajoutent deux sorties depuis n'importe quel
  //      panneau : le bouton du bandeau, et la touche Échap.
  //   2. Le mode se VOIT. Un outil dont plus aucun bouton ne répond, sans explication,
  //      passe pour cassé : tout panneau qui détourne pose un bandeau en tête de page.
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
  // c'est ici qu'on le consulte, à chaque clic. Les deux doivent rendre la même chose —
  // test/js/mode-trad.test.js compare les clés postées à celles du module.
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
  // Le texte qu'un élément porte EN PROPRE, et non celui de ses descendants réunis : sans
  // cette distinction, un clic dans la marge rendrait le panneau entier.
  function texteEnPropre(e) {
    var enfants = e.childNodes || [];
    var propre = '';
    var elements = 0;
    for (var i = 0; i < enfants.length; i++) {
      if (enfants[i].nodeType === 3) { propre += enfants[i].nodeValue || ''; }
      else if (enfants[i].nodeType === 1) { elements++; }
    }
    propre = normaliserTrad(propre);
    // Sans aucun descendant, le textContent EST le texte propre.
    if (propre === '' && elements === 0) { propre = normaliserTrad(e.textContent); }
    return propre;
  }

  // Ces éléments-là portent un libellé d'un seul tenant : un bouton fait d'un pictogramme
  // et d'un mot n'a pas de texte « en propre », et c'est pourtant son mot qu'on vient
  // relire. Ailleurs, on s'en tient au texte propre.
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
    // Les textes qui ne vivent dans aucun nœud de texte. `value` seulement sur un bouton :
    // sur un champ de saisie, ce serait ce que le rédacteur vient de taper, jamais un
    // libellé de l'outil.
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

  // L'élément le plus PROCHE qui porte un texte, en remontant depuis la cible du clic.
  function texteCliquable(depart) {
    var e = depart;
    var garde = 0;
    while (e && e.nodeType === 1 && garde < 40) {
      var t = texteDe(e);
      if (t !== '') { return t; }
      if (e === document.body) { return ''; }
      // Remonter d'un cran : `parentElement` dans le DOM, les replis pour les hôtes de
      // rendu réduits, où le lien porte un autre nom.
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

  function surClicTrad(ev) {
    if (!trad.actif || trad.exclue) { return; }
    var cible = ev.target || null;
    // Le bandeau reste cliquable : c'est la sortie du mode.
    if (dansBandeau(cible)) { return; }
    // On barre la route AVANT de savoir si un texte a été trouvé : sinon un clic dans la
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

  // Éteindre depuis n'importe quel panneau. On éteint ICI d'abord — la page redevient
  // cliquable sans attendre l'hôte — puis on le lui dit : c'est lui qui écrit le réglage et
  // prévient les autres panneaux ouverts.
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
      // En CAPTURE et sur <body> : tout le contenu de la page y est, et la capture y passe
      // avant le moindre gestionnaire posé sur un descendant — sans quoi le bouton aurait
      // déjà agi quand nous serions prévenus.
      document.body.addEventListener('click', surClicTrad, true);
      document.body.addEventListener('keydown', surToucheTrad, true);
    }
    poserBandeau();
  }

  // L'index pèse des dizaines de kilo-octets : il ne part que si le mode est allumé. C'est
  // donc la page qui demande, et l'hôte qui répond — ou se tait.
  //
  // La demande voyage AVEC le « pret » (voir annoncerPret) plutôt que dans un message à
  // elle : un aller-retour de plus à chaque ouverture de panneau n'apprendrait rien de
  // neuf, et le socle n'a pas à ajouter un message au protocole que chaque page décrit en
  // tête de son fichier.
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
  // Poser le HTML d'une webview la charge : un hôte qui branche son écoute après ce
  // geste peut manquer le « pret » de la page, ne jamais envoyer les valeurs, et laisser
  // un formulaire vide sans que rien ne le dise. Les hôtes du cockpit écoutent maintenant
  // avant de poser le HTML ; cette reprise est la seconde ceinture, pour les fois où
  // l'ordre se reperdrait ou où le message se perd ailleurs. `recu` doit rendre vrai dès
  // le premier message reçu de l'hôte, quel qu'il soit.
  //
  // Un jeton (`requete`), le même à chaque relance : sur un aller-retour lent, l'hôte peut
  // répondre deux fois à « pret » avant que la première réponse n'arrive, et la seconde
  // « valeurs »/« charger » atterrirait alors après que le rédacteur a commencé à taper —
  // la reconstruire écraserait cette saisie. L'hôte recopie ce jeton dans sa réponse ;
  // jetonDejaTraite() (plus bas) dit à la page laquelle honorer.
  function annoncerPret(api, recu) {
    var essais = 0;
    var requete = Date.now().toString(36) + Math.random().toString(36).slice(2);
    // Toutes les pages passent par ici, avec leur api : c'est le seul endroit où le socle
    // tienne de quoi parler à l'hôte sans que chacune ait à le lui passer. `modeTrad` dit
    // « et dis-moi aussi si le mode est allumé » ; les pages qui s'en excluent ne le
    // portent pas, et l'hôte ne leur envoie donc jamais l'index.
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
  // réponse déjà traitée), faux sinon — et retient alors ce jeton comme consommé. `etat`
  // est un objet `{ jeton: null }` tenu par la page, un par formulaire. Une réponse sans
  // jeton (un rechargement déclenché par un geste, pas par « pret ») n'est jamais un
  // doublon. Un rechargement forcé (`msg.rechargement === true` : fiche périmée, écrite
  // ailleurs, ou réponse à « demande-rechargement ») passe toujours, même sur un jeton déjà
  // vu — sans quoi la webview resterait périmée sous les yeux du rédacteur.
  function jetonDejaTraite(etat, msg) {
    if (msg.rechargement) { return false; }
    if (msg.requete === undefined || msg.requete === null) { return false; }
    if (etat.jeton === msg.requete) { return true; }
    etat.jeton = msg.requete;
    return false;
  }

  // ---- Barre de commandes ----
  //
  // Texte court plus pictogramme : le premier dit ce que fait le bouton, le second le fait
  // reconnaître d'un coup d'oeil dans une barre qui en porte plusieurs. Un bouton vaut
  // { id, libelle, icone, tip, principal, danger, desactive, actif, groupe } et
  // `onAction(id)` est appelé au clic — `groupe` n'est lu par aucune fonction d'ici : c'est
  // un contrat entre l'hôte et la page appelante (media/articles.js, qui répartit ses
  // boutons sur deux lignes selon ce champ), invisible à ce composant. Rend la zone d'état
  // de la barre, où l'appelant écrit ce qu'il vient de faire.
  //
  // `opts.sansEtat` omet le pousse et la zone d'état (rend alors null) : une page à
  // plusieurs barres ne doit en garder qu'UNE avec role="status" — deux zones concurrentes,
  // et un lecteur d'écran annoncerait deux fois le même geste, ou aucune. Sans cette
  // option, tout se comporte comme avant : les trois autres vues d'ensemble (Traductions,
  // Word en attente, Contrôles, media/vue-ensemble.js) n'ont qu'une barre et ne la passent
  // jamais.
  //
  // `actif` (booléen, absent sur un bouton ordinaire) fait de ce bouton un INTERRUPTEUR :
  // aria-pressed part avec, et _design.css lui donne alors le fond plein. L'état allumé
  // veut dire « ce que ce bouton commande est à l'écran », jamais « le clic va l'allumer »
  // — c'est le sens que le reste de l'éditeur donne à un bouton de barre allumé. Le libellé
  // d'un interrupteur ne bouge donc PLUS avec son état (WAI-ARIA : un bouton à bascule garde
  // son nom, seul aria-pressed change) ; c'est l'infobulle qui dit le geste à venir.
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
  // puis les commandes et l'état. Tout dans une seule rangée passait à la ligne au hasard
  // des longueurs, et deux cartes voisines ne se lisaient plus de la même façon.
  //
  // Une seule implémentation pour toutes les vues d'ensemble — « Traductions », « Word en
  // attente », « Articles » — et pour celles qui viendront. Une ligne vaut :
  //
  //   { cle, groupe, titre, meta, notif: { ton, texte },
  //     messages: [{ ton, texte, action }],
  //     pastilles: [{ texte, ton, icone }], ouvrir,
  //     actions: [{ id, libelle, icone, tip, desactive, danger }],
  //     taches: [{ id, libelle, faite }],
  //     constats: [{ ton, texte }] }
  //
  // `messages` : plusieurs défauts dans une même carte, une phrase chacun, le geste de
  // chacun au bout de sa phrase. C'est ce qui permet à la vue Contrôles de tenir un article
  // par carte au lieu d'une carte par défaut. `action` vaut une entrée de `actions` — ou
  // null quand rien n'est à faire ailleurs — et part par le même opts.onAction(cle, id).
  //
  // opts.conteneur   élément qui reçoit les cartes
  // opts.textes()    -> { ouvrir, listeVide }, relu à chaque rendu : la langue peut arriver après
  // opts.onOuvrir(cle) / opts.onAction(cle, id) / opts.onTache(cle, id, cochee)
  //
  // Rend { rendre, majPastilles, focaliser }. `focaliser(valeur)` amène à l'écran la carte
  // dont `cle` vaut `valeur` et la marque quelques secondes — additif : une carte dont
  // `cle` est vide ne porte pas de [data-cle] et ne se rend pas autrement qu'avant.
  function listeCartes(opts) {
    var conteneur = opts.conteneur;
    var lireTextes = opts.textes || function () { return {}; };
    // Les pieds de carte, par clé : c'est ce qui permet de rafraîchir une seule pastille
    // sans reconstruire la liste. Les compteurs de tâches suivent le même besoin :
    // cocher une case ne repose que son entête, jamais la carte entière.
    var pieds = {};
    var compteurs = {};

    // Le compteur de l'entête « À faire », posé à la construction et reposé seul quand une
    // case est cochée. `resume` est { texte, toutes } ou null quand la revue ne définit
    // aucune tâche — un entête sans compteur n'affiche alors que son titre.
    function poserCompteurTaches(compteur, resume) {
      compteur.textContent = resume ? (resume.texte || '') : '';
      compteur.classList.toggle('szh-taches-compteur--ok', !!(resume && resume.toutes));
    }

    // Ce qui reste à faire sur cette carte, dans un seul encadré : les tâches cochables,
    // puis ce que la carte signale — d'abord ce qui mérite un regard, ensuite ce qui
    // arrêtera la publication. Trois groupes, trois titres, un seul cadre : l'avancement et
    // les avertissements se lisent d'un coup, et non l'un dans le pied et l'autre dans la
    // barre de titre.
    //
    // L'encadré naît dès qu'un des trois groupes a quelque chose à montrer ; une carte sans
    // tâche ni constat n'en a pas du tout.
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

    // Un groupe de constats d'un même ton, titre compris — rien du tout quand aucun
    // constat ne porte ce ton, plutôt qu'un titre suivi du vide.
    function poserGroupeConstats(bloc, constats, ton, titre) {
      var miens = [];
      for (var i = 0; i < constats.length; i++) {
        // Les tons inconnus retombent sur « attention » : un constat ne doit jamais
        // disparaître parce que son ton a été mal orthographié côté hôte.
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

    // Une phrase de défaut et, au bout, le geste qui mène là où on le corrige. Le bouton
    // est posé DANS le corps de la notification, pas à côté : il suit ainsi le dernier mot
    // et se replie avec le texte, au lieu de s'ancrer dans un coin que l'œil ne relie plus
    // à la phrase.
    function messageAvecGeste(ligne, msg) {
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
      var boite = notif(msg.ton || 'info', contenu);
      // La croix, seulement là où l'hôte l'autorise — c'est lui qui sait qu'un message est
      // gris (lib/constats.js, fermable), et la page ne le redevine pas. Elle est posée
      // hors du corps, contre le bord droit : le geste du défaut suit la phrase, celui-ci
      // ferme la boîte et n'a rien à voir avec ce qu'elle dit.
      if (msg.fermable && msg.empreinte) {
        var mots = lireTextes() || {};
        boite.appendChild(boutonIcone('croix', mots.fermerConstat || '',
          (function (empreinte, elem) {
            return function () {
              // Retirée tout de suite : l'hôte renverra la vue, mais le clic doit se voir
              // sans attendre l'aller-retour.
              elem.remove();
              if (opts.onFermer) { opts.onFermer(empreinte); }
            };
          }(String(msg.empreinte), boite)),
          'szh-notif-croix'));
      }
      return boite;
    }

    // Les pastilles d'une carte, reposées seules, et le compteur de son entête « À faire »
    // avec elles quand l'hôte l'envoie. Cocher une tâche ne doit pas reconstruire la liste :
    // le clavier perdrait le focus de la case qu'il vient d'utiliser, et deux clics
    // rapprochés courraient contre un DOM en train d'être remplacé.
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
        // [data-cle] additif : posé seulement quand la ligne porte une clé (le rapport de
        // conversion, par ex., n'en a pas). C'est ce que focaliser() retrouve — une carte
        // sans identifiant se rend exactement comme avant (revue F03, 22.09.2026).
        if (l.cle) { carte.dataset.cle = String(l.cle); }
        var tete = poser(carte, 'header', 'szh-tete');
        poser(tete, 'p', 'szh-tete-nom', l.titre || '');
        if (l.meta) { poser(tete, 'span', 'szh-tete-meta', l.meta); }
        // Ce qui demande d'être lu — un commentaire, un message de conversion, une erreur —
        // vit dans le corps de la carte, pas dans une infobulle.
        if (l.notif && l.notif.texte) {
          var corps = poser(carte, 'div', 'szh-corps');
          corps.appendChild(notif(l.notif.ton || 'info', l.notif.texte));
        }
        // Les défauts d'une carte groupée. Un pied par défaut aurait rendu la carte
        // illisible — trois phrases, trois rangées de boutons ; le geste tient donc au
        // bout de la phrase, en flèche étroite (.szh-ico--enligne, media/_liste.css).
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

    // Amène une carte précise à l'écran et la marque quelques secondes — le pendant, pour
    // une liste, de ce que focaliserChamp() fait sur un formulaire (media/_fiches.js) et
    // focaliser() sur une figure (media/medias-article.js) : même économie, un [data-cle]
    // et un temps d'affichage, jamais une seconde implémentation.
    //
    // `valeur` vide, ou qui ne correspond à aucun [data-cle] : rien ne se passe, jamais
    // d'erreur affichée, jamais de marquage faux — la table (lib/constats.js) vise « word »
    // avec des focus que toutes les cartes ne portent pas (le rapport de conversion n'a pas
    // de `cle`), et un fichier réimporté peut avoir disparu de la liste entre-temps.
    var minuteurFocus = null;
    var carteFocalisee = null;
    function focaliser(valeur) {
      var v = String(valeur === undefined || valeur === null ? '' : valeur);
      if (minuteurFocus) { clearTimeout(minuteurFocus); minuteurFocus = null; }
      if (carteFocalisee) { carteFocalisee.classList.remove('szh-carte--focus'); carteFocalisee = null; }
      if (v === '') { return; }
      // Une comparaison directe, pas un sélecteur CSS construit avec `v` : un nom de
      // fichier Word porte des caractères (espaces, parenthèses, accents) qu'un sélecteur
      // attribut ne prend pas tous proprement, là où focaliserChamp() peut se permettre un
      // sélecteur parce que ses clés de champ sont un jeu fermé (id de formulaire).
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

  // ---- Petits gestes de construction, recopiés à l'identique dans plusieurs pages ----
  //
  // Un bouton texte, un bouton d'icône seule, une ligne aplatie (retours à la ligne rendus
  // en espace), un gabarit « {0} » substitué depuis une table de textes, et l'écriture
  // d'une zone d'état : cinq fonctions d'une ligne ou deux, qui vivaient à l'identique dans
  // documentation.js et medias-article.js. Une page les reprend par un simple alias
  // (`var bouton = SZH.bouton;`), sans toucher à ses appels.
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
  // documentation.js et medias-article.js construisaient chacun la même barre — bouton
  // Enregistrer, bouton Retour, indicateur de modification, zone d'état — à trois lignes
  // d'écart : le message que « Retour » envoie à l'hôte, propre à chaque page, et un
  // compteur supplémentaire pour le gestionnaire des médias. Les deux voyagent par
  // `opts.onRetour` et `opts.avecCompte`.
  //
  // opts = { txt, onEnregistrer(), onRetour(), avecCompte }
  // Rend { enregistrer, indic, etat, compte? } : les éléments que la page doit garder.
  function construireBarre(conteneur, opts) {
    var o = opts || {};
    var txt = o.txt || {};
    conteneur.textContent = '';
    conteneur.className = 'szh-barre';
    var ctl = {};
    ctl.enregistrer = bouton(txt.enregistrer, function () { if (o.onEnregistrer) { o.onEnregistrer(); } },
      'szh-bouton--principal', txt.enregistrerTip);
    conteneur.appendChild(ctl.enregistrer);
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
  // et une photo d'auteur·e (20 Mo, jamais de SVG ni de GIF, le WebP en plus). Une seule
  // table plutôt que quatre copies dispersées. Ces valeurs ne sont qu'un repli : le message
  // de chargement de chaque webview porte `limites` (lib/medias.js et les constantes photo
  // d'extension.js, la source unique), et appliquerLimites() les pose ici — la table ne
  // change donc que si l'hôte la dément, jamais par une seconde copie littérale.
  var LIMITES = {
    image: { maxi: 50 * 1024 * 1024, extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg'] },
    photo: { maxi: 20 * 1024 * 1024, extensions: ['png', 'jpg', 'jpeg', 'webp'] }
  };

  // `limites` = { imageMax, imageExtensions, photoMax, photoExtensions } (ou absent : les
  // valeurs ci-dessus restent alors en place, repli utile aux tests qui postent un message
  // minimal). Une clé manquante isolément laisse sa propre valeur par défaut inchangée.
  function appliquerLimites(limites) {
    if (!limites) { return; }
    if (limites.imageMax !== undefined) { LIMITES.image.maxi = limites.imageMax; }
    if (limites.imageExtensions !== undefined) { LIMITES.image.extensions = limites.imageExtensions; }
    if (limites.photoMax !== undefined) { LIMITES.photo.maxi = limites.photoMax; }
    if (limites.photoExtensions !== undefined) { LIMITES.photo.extensions = limites.photoExtensions; }
  }

  // ---- Moteur d'autocomplétion partagé (noms d'auteur·e·s, mots-clés edudoc.ch) ----
  //
  // _auteurs.js et _fiches.js pliaient chacun casse et accents à leur façon pour chercher
  // « commence par ce mot », avec deux écarts qui ne se justifiaient pas : `plier()`
  // laissait les espaces de bord (le point d'appel des auteur·e·s les retirait après coup,
  // celui des mots-clés jamais) et le jeu de séparateurs de mot des auteur·e·s ignorait la
  // virgule et le point-virgule, qui séparent pourtant les descripteurs d'un thésaurus
  // (« troubles, difficultés »). On garde le comportement le plus large des deux : un
  // repli systématique, et le séparateur qui inclut la ponctuation des deux usages.
  var SEPARE_MOT = /[\s\-'’.,;]/;

  // Casse et accents pliés, sans le détail des positions : sert à comparer deux noms
  // (tri alphabétique), pas à chercher dans un texte.
  function plier(t) {
    var s = String(t === undefined || t === null ? '' : t).toLowerCase().replace(/\s+/g, ' ').trim();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }
    catch (e) { /* moteur sans normalize : filtrage sensible aux accents, sans casser */ }
    return s;
  }

  // Plie un texte ET garde, pour chaque caractère du plié, l'indice du caractère d'origine
  // dont il vient : sans cette table, mettre en gras la part trouvée obligerait à découper
  // l'original aux indices du plié — ce qui se décale exactement sur les caractères qu'un
  // repli Unicode change de longueur (« İ », par exemple).
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

  // Les indices, dans le plié, où commence un mot — espace, trait d'union, apostrophes,
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
  // Rien n'est construit en HTML : un nom ou un descripteur est une donnée, pas du balisage.
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
  // Cinq pages en avaient chacune une copie : input file caché + bouton « Choisir un
  // fichier » + glisser-déposer, sur un même cadre `.szh-depot` (survol : `.szh-depot.survol`,
  // media/_design.css). Cette fonction ne décide de rien après le choix du fichier :
  // `opts.surFichier(fichier)` reçoit le File choisi ou déposé, à charge pour l'appelant de
  // le valider et de le lire — voir `SZH.lireBase64` plus bas, le second motif recopié.
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
    // Icône et libellé facultatifs : une zone qui n'en reçoit ni l'un ni l'autre reste
    // muette, comme avant l'unification de ce motif — ajouter un pictogramme que
    // personne n'a demandé serait le changement visuel que ce lot s'interdit.
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
    // « alert » et non « status » : cette zone ne porte que le sort d'UN dépôt (en cours,
    // refusé, réussi), jamais un message d'ambiance — elle mérite d'interrompre plutôt que
    // d'attendre une pause dans la parole, contrairement à la barre d'état générale.
    var etat = poser(d, 'span', 'szh-depot-etat');
    etat.setAttribute('role', 'alert');
    return { element: d, titre: titre, choisir: choisir, fichier: fichier, etat: etat };
  }

  // Lecture d'un fichier en base64, formats et poids revérifiés ici et par l'hôte de toute
  // façon : la webview le dit tout de suite plutôt que d'envoyer un fichier qu'il refusera.
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
    construireDepot: construireDepot, lireBase64: lireBase64
  };
})();
