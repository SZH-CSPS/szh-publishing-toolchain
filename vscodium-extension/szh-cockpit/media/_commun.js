// SZH cockpit — socle commun des webviews (D121/D122), injecté par construireHtml
// AVANT le script de la page. Zéro dépendance, zéro accès réseau : que du DOM.
//
//   SZH.autoEnregistrement(opts)  enregistrement automatique, sans voler le curseur
//   SZH.motsCles(opts)            éditeur de mots-clés APPARIÉS, partagé par les
//                                 trois formulaires qui touchent aux mots-clés
//                                 (traduction, métadonnées des articles,
//                                 vérification de l'import)
var SZH = (function () {
  'use strict';

  // ---- Enregistrement automatique (D121) --------------------------------------------
  //
  // Trois déclencheurs, complémentaires :
  //   • 3 s après la DERNIÈRE frappe (et non toutes les 3 s : on n'enregistre pas au
  //     milieu d'un mot) ;
  //   • dès qu'un champ perd le focus (`focusout`) ou change (`change` : menus, cases) —
  //     c'est le « l'utilisateur clique ailleurs » ;
  //   • quand la webview entière perd le focus ou passe en arrière-plan — dernier
  //     rempart avant que VS Code ne détruise le DOM (ces panneaux n'ont pas
  //     `retainContextWhenHidden`).
  // L'hôte répond « enregistre » SANS renvoyer les valeurs quand la demande est
  // automatique (`auto: true`) : pas de re-rendu, donc ni curseur ni sélection perdus.
  //
  // opts.estModifie()        -> booléen : y a-t-il quelque chose à écrire ?
  // opts.enregistrer(auto)   -> poste la demande à l'hôte (auto = true ici)
  // opts.delai               -> ms avant l'enregistrement différé (défaut 3000 ;
  //                             0 = pas de minuteur ni de déclencheur au champ, il ne
  //                             reste que la perte de focus de la webview — pour la
  //                             fiche image, dont l'écriture recompile l'article)
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
    // À appeler à la réception de « enregistre » ou « erreur » : libère le verrou et
    // rejoue la demande si l'utilisateur a continué à taper pendant l'écriture.
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

  // ---- Mots-clés appariés (D122) ------------------------------------------------------
  //
  // « diagnostic » ↔ « Diagnose » : le lien est la POSITION dans la liste — le YAML
  // n'a rien d'autre pour le dire. D'où cette grille : une RANGÉE par mot-clé, une
  // colonne par langue, et l'ordre n'est pas modifiable à la souris. On n'ajoute ni
  // ne retire un mot-clé dans une seule langue : on ajoute ou on retire une RANGÉE,
  // donc la paire entière — l'appariement est juste par construction.
  //
  // Une case laissée vide s'écrit « TO BE TRANSLATED » (MARQUE) et non rien : une
  // valeur vide disparaîtrait à la sérialisation et tout ce qui suit remonterait d'un
  // cran. La marque tient la place, et le manque se voit dans le fichier. À l'écran
  // elle est rendue comme du vide (placeholder) : on tape par-dessus.
  //
  // opts.langues  [{ code, libelle, lecture }]  lecture:true = colonne non éditable
  // opts.listes   { fr:[…], de:[…] }            valeurs de départ
  // opts.textes   { motCle, sansEquivalent, ajouter, retirer, aide }
  // opts.edition  true = rangées ajoutables/retirables (formulaires de métadonnées) ;
  //               false = structure figée (panneau de traduction : on traduit, on
  //               n'invente pas de mots-clés)
  // opts.onChange appelé à chaque frappe et à chaque ajout/retrait de rangée
  //
  // -> { element, collecter(), reconstruire(langues) }
  //    collecter() renvoie { fr:[…], de:[…] } DÉJÀ ALIGNÉ : chaque langue non vide
  //    est complétée par la marque jusqu'au nombre de rangées ; une langue dont
  //    aucune case n'est remplie renvoie [] (rien à écrire dans la fiche).
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
      '  background: var(--vscode-button-secondaryBackground, var(--vscode-button-background)); }',
      '.mc-aide { color: var(--vscode-descriptionForeground); margin: .1rem 0 .3rem; font-size: .85em; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function motsCles(opts) {
    poserStyleMotsCles();
    var textes = opts.textes || {};
    var element = document.createElement('div');
    var langues = opts.langues || [];
    var corps = null;
    // MODÈLE interne : { code: [mots] } pour TOUTES les langues rencontrées, y
    // compris celles qui ne sont pas affichées (l'italien tant que « + Italien » est
    // décoché). Sans lui, retirer une rangée décalerait la langue masquée — et le
    // formulaire de métadonnées perdrait purement et simplement les mots-clés IT
    // d'un article dès qu'on toucherait aux mots-clés FR/DE.
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
    // Recopie ce qui est à l'écran dans le modèle (les langues masquées gardent leur
    // valeur), puis égalise toutes les listes sur le nombre de rangées.
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
      // n° + une colonne par langue (+ la poubelle en édition)
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
          // On retire la RANGÉE, donc le mot-clé dans TOUTES les langues, masquées
          // comprises : retirer « diagnostic » sans retirer « Diagnose » décalerait
          // tout le reste.
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

    // Valeurs telles quelles (vides comprises), sans alignement — toutes langues.
    function collecterBrut() {
      absorber();
      var res = {};
      for (var code in modele) { res[code] = modele[code].slice(); }
      return res;
    }

    // Valeurs à ÉCRIRE : chaque langue entamée est complétée par la marque jusqu'au
    // nombre de rangées ; une langue vierge ne produit rien.
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

    // rendre() reconstruit le DOM DEPUIS le modèle, sans jamais le relire — c'est
    // essentiel après un ajout ou un retrait de rangée : absorber() y remettrait
    // l'ANCIEN DOM (encore à l'écran) par-dessus la modification qu'on vient de
    // faire, et le retrait n'aurait tout simplement aucun effet.
    function rendre() {
      element.textContent = '';
      if (textes.aide) {
        var aide = document.createElement('p');
        aide.className = 'mc-aide';
        aide.textContent = textes.aide;
        element.appendChild(aide);
      }
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

    // Changement des colonnes affichées (case « + Italien ») : là, au contraire, il
    // FAUT relire l'écran d'abord — une frappe en cours ne doit pas être perdue.
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
      // Changer les colonnes affichées (case « + Italien ») sans rien perdre.
      reconstruire: function (l) { reconstruire(l); }
    };
  }

  return { autoEnregistrement: autoEnregistrement, motsCles: motsCles, MARQUE_A_TRADUIRE: MARQUE };
})();
