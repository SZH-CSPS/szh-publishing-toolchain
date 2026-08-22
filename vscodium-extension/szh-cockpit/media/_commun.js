// Socle commun des webviews, injecté par construireHtml avant le script de la page.
// Sans dépendance ni accès réseau : rien que du DOM.
//
//   SZH.autoEnregistrement(opts)  enregistrement automatique, sans voler le curseur
//   SZH.motsCles(opts)            éditeur de mots-clés appariés, partagé par les trois
//                                 formulaires qui touchent aux mots-clés
//   SZH.annoncerPret(api, recu)   « pret », redemandé tant que l'hôte se tait
//   SZH.icone(nom)                une icône de 16 px, dessinée en SVG
//   SZH.notif(ton, contenu)       une notification : info, ok, attention, danger
//   SZH.poserAccent(hex)          la couleur annuelle du numéro devient l'accent
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
    ok: [['path', { d: 'M6.4 11.9 2.9 8.4 4 7.3l2.4 2.4 5.6-5.6 1.1 1.1z' }]]
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
      document.addEventListener('change', ecrire, true);
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
        vue.textContent = valeur !== '' ? valeur : (textes.sansEquivalent || '—');
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

    rendre();
    return {
      element: element,
      collecter: collecter,
      collecterBrut: collecterBrut,
      reconstruire: function (l) { reconstruire(l); }
    };
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

  return {
    autoEnregistrement: autoEnregistrement, motsCles: motsCles,
    annoncerPret: annoncerPret, icone: icone, notif: notif, poserAccent: poserAccent,
    MARQUE_A_TRADUIRE: MARQUE
  };
})();
