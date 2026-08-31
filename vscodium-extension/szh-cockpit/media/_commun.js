// Socle commun des webviews, injecté par construireHtml avant le script de la page.
// Sans dépendance ni accès réseau : rien que du DOM.
//
//   SZH.autoEnregistrement(opts)  enregistrement automatique, sans voler le curseur
//   SZH.motsCles(opts)            éditeur de mots-clés appariés, partagé par les trois
//                                 formulaires qui touchent aux mots-clés
//   SZH.choixFerme(opts)          un intitulé et un <select> à liste fermée, sur une carte
//   SZH.choixLangue(opts)         le <select> de la langue d'un article, posé sur sa carte
//   SZH.annoncerPret(api, recu)   « pret », redemandé tant que l'hôte se tait
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
    // Agrandir un aperçu : un cercle en contour et un manche oblique.
    loupe: [
      ['circle', { cx: '7', cy: '7', r: '4.25', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' }],
      ['path', { d: 'M10.4 10.4 14 14', fill: 'none', stroke: 'currentColor',
        'stroke-width': '1.5', 'stroke-linecap': 'round' }]
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
      i.placeholder = MARQUE;
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
    select.setAttribute('id', id);
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

  // ---- Annonce de la page ----
  //
  // Poser le HTML d'une webview la charge : un hôte qui branche son écoute après ce
  // geste peut manquer le « pret » de la page, ne jamais envoyer les valeurs, et laisser
  // un formulaire vide sans que rien ne le dise. Les hôtes du cockpit écoutent maintenant
  // avant de poser le HTML ; cette reprise est la seconde ceinture, pour les fois où
  // l'ordre se reperdrait ou où le message se perd ailleurs. `recu` doit rendre vrai dès
  // le premier message reçu de l'hôte, quel qu'il soit.
  function annoncerPret(api, recu) {
    var essais = 0;
    api.postMessage({ type: 'pret' });
    var minuteur = setInterval(function () {
      essais++;
      if ((recu && recu()) || essais > 6) { clearInterval(minuteur); return; }
      api.postMessage({ type: 'pret' });
    }, 350);
  }

  // ---- Barre de commandes ----
  //
  // Texte court plus pictogramme : le premier dit ce que fait le bouton, le second le fait
  // reconnaître d'un coup d'oeil dans une barre qui en porte plusieurs. Un bouton vaut
  // { id, libelle, icone, tip, principal, danger, desactive } et `onAction(id)` est appelé
  // au clic. Rend la zone d'état de la barre, où l'appelant écrit ce qu'il vient de faire.
  function boutonCommande(b, onAction) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'szh-bouton'
      + (b.principal ? ' szh-bouton--principal' : '')
      + (b.danger ? ' bouton-danger' : '');
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

  function barreBoutons(conteneur, boutons, onAction) {
    conteneur.textContent = '';
    for (var i = 0; i < (boutons || []).length; i++) {
      conteneur.appendChild(boutonCommande(boutons[i], onAction));
    }
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
  //     pastilles: [{ texte, ton, icone }], ouvrir,
  //     actions: [{ id, libelle, icone, tip, desactive, danger }],
  //     taches: [{ id, libelle, faite }] }
  //
  // opts.conteneur   élément qui reçoit les cartes
  // opts.textes()    -> { ouvrir, listeVide }, relu à chaque rendu : la langue peut arriver après
  // opts.onOuvrir(cle) / opts.onAction(cle, id) / opts.onTache(cle, id, cochee)
  function listeCartes(opts) {
    var conteneur = opts.conteneur;
    var lireTextes = opts.textes || function () { return {}; };
    // Les pieds de carte, par clé : c'est ce qui permet de rafraîchir une seule pastille
    // sans reconstruire la liste. Les compteurs de tâches suivent le même besoin (A7.5) :
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

    // Les tâches de l'article, cochables sur la carte : l'avancement doit se lire et se
    // changer sans ouvrir quoi que ce soit. Une case par tâche, l'intitulé dans son label,
    // donc rien à apparier par identifiant. Un entête les distingue franchement du reste de
    // la carte (A7.2) et porte le compteur d'avancement, qui vivait en pastille du pied
    // avant que A7.5 ne le rapproche des cases qu'il résume.
    function poserTaches(carte, ligne) {
      var bloc = poser(carte, 'div', 'szh-taches');
      var entete = poser(bloc, 'div', 'szh-taches-entete');
      poser(entete, 'span', 'szh-taches-titre', (lireTextes() || {}).tachesEntete || '');
      var compteur = poser(entete, 'span', 'szh-taches-compteur');
      poserCompteurTaches(compteur, ligne.tachesResume);
      for (var i = 0; i < ligne.taches.length; i++) {
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
        }(ligne.taches[i]));
      }
      return { bloc: bloc, compteur: compteur };
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
        var tete = poser(carte, 'header', 'szh-tete');
        poser(tete, 'p', 'szh-tete-nom', l.titre || '');
        if (l.meta) { poser(tete, 'span', 'szh-tete-meta', l.meta); }
        // Ce qui demande d'être lu — un commentaire, un message de conversion, une erreur —
        // vit dans le corps de la carte, pas dans une infobulle.
        if (l.notif && l.notif.texte) {
          var corps = poser(carte, 'div', 'szh-corps');
          corps.appendChild(notif(l.notif.ton || 'info', l.notif.texte));
        }
        if (l.taches && l.taches.length > 0) {
          compteurs[String(l.cle || '')] = poserTaches(carte, l).compteur;
        }
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

    return { rendre: rendre, majPastilles: majPastilles };
  }

  return {
    autoEnregistrement: autoEnregistrement, motsCles: motsCles,
    choixFerme: choixFerme, choixLangue: choixLangue,
    annoncerPret: annoncerPret, icone: icone, notif: notif, poserAccent: poserAccent,
    barreBoutons: barreBoutons, boutonCommande: boutonCommande, listeCartes: listeCartes,
    poser: poser, modale: modale, LANGUES_CHOIX: LANGUES_CHOIX,
    MARQUE_A_TRADUIRE: MARQUE
  };
})();
