// Les champs d'une fiche de Documentation, tirés du contrat (typesConfig[].champs) : la
// carte de la Documentation du numéro et le détail d'une proposition les construisent ici.

(function () {
  'use strict';

  var texte = SZH.poser, ligne = SZH.ligne, bouton = SZH.bouton, boutonIcone = SZH.boutonIcone;

  // Les demandes de forme imprimée (DOC_DATE_FORMER) de tous les formulaires de la page : un
  // seul compteur de jetons, une seule table de rappels, pour que DOC_DATE_FORMEE trouve son
  // destinataire.
  var DELAI_APERCU_DATE = 400;
  var DELAI_REPONSE_DATE = 5000;
  var rappelsDate = {};
  var dernierJetonDate = 0;
  function recevoirDate(msg) {
    var rappel = rappelsDate[msg.jeton];
    delete rappelsDate[msg.jeton];
    if (rappel) { rappel(msg); }
  }
  // La forme imprimée d'une valeur hors de tout champ (le libellé d'un bouton, par exemple) :
  // `rappel` reçoit la réponse de l'hôte telle quelle.
  function former(api, saisie, valeurs, rappel) {
    var jeton = ++dernierJetonDate;
    rappelsDate[jeton] = rappel;
    api.postMessage({ type: SZH.MSG.DOC_DATE_FORMER, jeton: jeton, saisie: saisie, valeurs: valeurs });
  }

  function creer(options) {
    var ctx = Object.assign({
      api: { postMessage: function () {} },
      txt: function () { return {}; },
      types: function () { return []; },
      index: (function () { var n = 0; return function () { return ++n; }; })(),
      etat: function () {}, majEtatCarte: function () {}, majModifie: function () {},
      extensionsImage: function () { return []; },
      envoyerImage: function () {}, poserVignette: function () {},
      // Après toute saisie dans un champ, par sa clé.
      surSaisie: function () {}
    }, options || {});
    function txt() { return ctx.txt() || {}; }

    // ---- Valeurs et complétude -----------------------------------------------------------
    //
    // La complétude reprend exactement la règle de kirby-contenu.js#champsManquants : un champ
    // `requis` dont `quand` ne tient pas ne compte pas, `structure` est vide si aucune ligne
    // n'a rien.
    function valeurChamp(c, champCfg) {
      // `fichier` ne pose pas de contrôle dans c.ctl (la zone de dépôt n'est pas un champ de
      // texte) : sa valeur vit à part, dans c.image — voir champFichier() plus bas.
      if (champCfg.saisie === 'fichier') { return c.image || ''; }
      var ctlChamp = c.ctl[champCfg.cle];
      if (!ctlChamp) { return (champCfg.saisie === 'structure' || champCfg.saisie === 'liste_multiple') ? [] : ''; }
      if (champCfg.saisie === 'structure') { return lireStructure(ctlChamp); }
      if (champCfg.saisie === 'liste_multiple') { return ctlChamp.valeurs.slice(); }
      if (champCfg.saisie === 'derive') { return ctlChamp.valeur || ''; }
      return ligne(ctlChamp.value);
    }
    function valeursFiche(c) {
      var v = {};
      for (var i = 0; i < c.champs.length; i++) { v[c.champs[i].cle] = valeurChamp(c, c.champs[i]); }
      return v;
    }

    function quandSatisfait(quand, v) {
      if (!quand) { return true; }
      return Object.keys(quand).every(function (cle) { return String(v[cle] || '') === String(quand[cle]); });
    }
    function champsManquants(c) {
      var v = valeursFiche(c);
      var manque = [];
      for (var i = 0; i < c.champs.length; i++) {
        var cfg = c.champs[i];
        if (!cfg.requis) { continue; }
        if (cfg.quand && !quandSatisfait(cfg.quand, v)) { continue; }
        var val = v[cfg.cle];
        var vide = (cfg.saisie === 'structure' || cfg.saisie === 'liste_multiple')
          ? !(Array.isArray(val) && val.length > 0) : String(val || '').trim() === '';
        if (vide) { manque.push(cfg.cle); }
      }
      return manque;
    }

    // ---- Visibilité conditionnelle (`quand`) et champs dépendants (instruments) ------------
    function majConditionnels(c) {
      if (!c.conditionnels) { return; }
      var v = valeursFiche(c);
      for (var i = 0; i < c.conditionnels.length; i++) {
        var cd = c.conditionnels[i];
        cd.conteneur.hidden = !quandSatisfait(cd.quand, v);
      }
    }
    // Le menu des instruments d'une intervention : quand le canton change, ses options
    // reviennent recomposées (celles qui l'observent en tête), la valeur choisie conservée si
    // elle existe encore dans le nouveau jeu.
    function rafraichirDependants(c, cleChangee) {
      if (!c.dependants) { return; }
      for (var i = 0; i < c.dependants.length; i++) {
        var d = c.dependants[i];
        if (d.dependDe !== cleChangee) { continue; }
        var sel = c.ctl[d.cle];
        if (!sel) { continue; }
        var valeurActuelle = sel.value;
        var canton = String(c.ctl[d.dependDe] ? c.ctl[d.dependDe].value : '');
        var options = d.optionsParCanton[canton] || d.optionsParCanton[''] || [];
        poserOptions(sel, options, valeurActuelle);
      }
    }
    // Les valeurs `derive` (curia…) affichées en lecture seule, recalculées depuis le champ
    // dont elles dépendent — jamais saisies, voir kirby-contenu.js#valeurDerive.
    function majDerives(c) {
      if (!c.derives) { return; }
      for (var i = 0; i < c.derives.length; i++) {
        var d = c.derives[i];
        var source = c.ctl[d.depuis] ? String(c.ctl[d.depuis].value || '') : '';
        var val = (d.table || {})[source] || '';
        d.affichage.textContent = val;
        d.valeur = val;
      }
    }

    // ---- Un champ : texte, texte_long, url, date, date_partielle, annee, liste, derive,
    //      structure, fichier — tout vient de champCfg, rien n'est un nom de champ en dur -----
    function poserOptions(sel, options, valeurGardee) {
      var courant = valeurGardee !== undefined ? valeurGardee : sel.value;
      sel.textContent = '';
      var vide = document.createElement('option');
      vide.value = '';
      vide.textContent = txt().optionVide || '–';
      sel.appendChild(vide);
      var connue = courant === '';
      for (var i = 0; i < options.length; i++) {
        var o = document.createElement('option');
        o.value = String(options[i].valeur || '');
        o.textContent = String(options[i].libelle || options[i].valeur || '');
        sel.appendChild(o);
        if (o.value === courant) { connue = true; }
      }
      if (!connue && courant !== '') {
        var extra = document.createElement('option');
        extra.value = courant;
        extra.textContent = courant;
        sel.appendChild(extra);
      }
      sel.value = courant;
    }

    function lireStructure(ctlChamp) {
      return ctlChamp.lignes.map(function (ligneCtl) {
        var o = {};
        ctlChamp.sousChamps.forEach(function (sc) { o[sc.cle] = ligne(ligneCtl[sc.cle].value); });
        return o;
      }).filter(function (o) {
        return ctlChamp.sousChamps.some(function (sc) { return o[sc.cle] !== ''; });
      });
    }

    function champStructure(parent, c, champCfg, valeursInitiales) {
      var d = texte(parent, 'div', 'szh-champ doc-champ-structure');
      texte(d, 'span', 'doc-structure-label', champCfg.libelle || '');
      var zoneLignes = texte(d, 'div', 'doc-structure-lignes');
      var ctlChamp = { conteneur: zoneLignes, lignes: [], sousChamps: champCfg.structureChamps || [] };
      c.ctl[champCfg.cle] = ctlChamp;

      function surChangementLigne() {
        c.touchee = true; ctx.etat(''); ctx.majEtatCarte(c); ctx.majModifie(); ctx.surSaisie(c, champCfg.cle);
      }
      function ajouterLigne(valeurs0) {
        var row = texte(zoneLignes, 'div', 'doc-structure-ligne');
        var ligneCtl = {};
        for (var i = 0; i < ctlChamp.sousChamps.length; i++) {
          var sc = ctlChamp.sousChamps[i];
          var sousDiv = texte(row, 'div', 'doc-structure-souschamp');
          var idSous = 'sc-' + champCfg.cle + '-' + sc.cle + '-' + (ctx.index());
          var lab = texte(sousDiv, 'label', null, sc.libelle || '');
          lab.setAttribute('for', idSous);
          var valeurInitiale = String((valeurs0 || {})[sc.cle] || '');
          var input;
          if (sc.saisie === 'liste' && sc.options) {
            input = document.createElement('select');
            poserOptions(input, sc.options, valeurInitiale);
            input.addEventListener('change', surChangementLigne);
          } else {
            input = document.createElement('input');
            input.type = sc.saisie === 'date' ? 'date' : (sc.saisie === 'url' ? 'url' : 'text');
            input.maxLength = 300;
            if (input.type === 'date') {
              if (poserValeurDate(input, valeurInitiale)) { input.classList.add('doc-date-champ--erreur'); }
            } else { input.value = valeurInitiale; }
            input.addEventListener('input', surChangementLigne);
          }
          input.id = idSous;
          sousDiv.appendChild(input);
          // Une date de suivi illisible se signale déjà par sa classe ; sa forme suit la saisie.
          if (sc.saisie === 'date') { brancherApercuDateLigne(sousDiv, input, c, sc.cle); }
          ligneCtl[sc.cle] = input;
        }
        row.appendChild(boutonIcone('poubelle', txt().retirerLigneTip || '', function () {
          row.remove();
          var idx = ctlChamp.lignes.indexOf(ligneCtl);
          if (idx !== -1) { ctlChamp.lignes.splice(idx, 1); }
          surChangementLigne();
        }, 'szh-ico--danger'));
        ctlChamp.lignes.push(ligneCtl);
      }
      for (var i = 0; i < (valeursInitiales || []).length; i++) { ajouterLigne(valeursInitiales[i]); }
      d.appendChild(bouton(txt().ajouterLigne || '+', function () { ajouterLigne({}); surChangementLigne(); },
        'doc-structure-ajouter', txt().ajouterLigneTip || ''));
      return d;
    }

    function champDerive(parent, c, champCfg) {
      var d = texte(parent, 'div', 'szh-champ doc-champ-derive');
      texte(d, 'span', null, champCfg.libelle || '');
      var affichage = texte(d, 'span', 'doc-derive-valeur', '');
      var obj = { affichage: affichage, depuis: champCfg.depuis, table: champCfg.table || {}, valeur: '' };
      c.ctl[champCfg.cle] = obj;
      c.derives = c.derives || [];
      c.derives.push(obj);
      return d;
    }

    function champFichier(parent, c, champCfg) {
      var zone = texte(parent, 'div', 'doc-image');
      var vignette = texte(zone, 'div', 'doc-vignette');
      c.ctl.vignette = vignette;
      c.avecImage = true;
      c.champFichier = champCfg.cle;
      var d = SZH.construireDepot({
        parent: zone, extensions: champCfg.extensions || ctx.extensionsImage(), texteChoisir: txt().choisirFichier || '',
        surFichier: function (f) { ctx.envoyerImage(c, f); }
      });
      c.ctl.depotEtat = d.etat;
      ctx.poserVignette(c);
      return zone;
    }

    function champOrdinaire(parent, c, champCfg) {
      var d = texte(parent, 'div', 'szh-champ');
      var id = 'ch-' + champCfg.cle + '-' + c.index;
      var l = texte(d, 'label', null, champCfg.libelle || '');
      l.setAttribute('for', id);
      var i;
      var surChangement = function () {
        c.touchee = true;
        ctx.etat('');
        ctx.majEtatCarte(c);
        majConditionnels(c);
        majDerives(c);
        rafraichirDependants(c, champCfg.cle);
        ctx.majModifie();
        ctx.surSaisie(c, champCfg.cle);
      };
      if (champCfg.saisie === 'liste') {
        i = document.createElement('select');
        poserOptions(i, champCfg.options || [], '');
        if (champCfg.dependDe) {
          c.dependants = c.dependants || [];
          c.dependants.push({ cle: champCfg.cle, dependDe: champCfg.dependDe, optionsParCanton: champCfg.optionsParCanton || {} });
        }
        i.addEventListener('change', surChangement);
      } else if (champCfg.saisie === 'texte_long') {
        i = document.createElement('textarea');
        i.rows = 3;
        i.maxLength = 4000;
        i.addEventListener('input', surChangement);
      } else {
        i = document.createElement('input');
        i.maxLength = champCfg.saisie === 'annee' ? 4 : 300;
        if (champCfg.saisie === 'date') { i.type = 'date'; }
        else if (champCfg.saisie === 'url') { i.type = 'url'; }
        else if (champCfg.saisie === 'annee') { i.type = 'text'; i.inputMode = 'numeric'; i.pattern = '\\d{4}'; i.placeholder = 'AAAA'; }
        else if (champCfg.saisie === 'date_partielle') { i.type = 'text'; i.pattern = '\\d{4}(-\\d{2}(-\\d{2})?)?'; i.placeholder = txt().dateModelePartiel || ''; }
        else { i.type = 'text'; }
        i.addEventListener('input', surChangement);
      }
      i.id = id;
      d.appendChild(i);
      c.ctl[champCfg.cle] = i;
      if (champCfg.saisie === 'date' || champCfg.saisie === 'date_partielle') { brancherApercuDate(d, i, c, champCfg); }
      return d;
    }

    // ---- Date stockée hors calendrier ---------------------------------------------------
    //
    // Un <input type="date"> vide sans rien dire une valeur qui n'existe pas au calendrier
    // (2026-02-30), et l'enregistrement suivant l'écrirait vide. Le champ repasse alors en
    // texte et garde la valeur lue ; rend true dans ce cas, pour que l'appelant la signale.
    function poserValeurDate(input, v) {
      input.value = v;
      if (v === '' || input.value === v) { return false; }
      input.type = 'text';
      input.pattern = '\\d{4}-\\d{2}-\\d{2}';
      input.value = v;
      return true;
    }
    function demanderApercuDesDates(c, cle) {
      var groupes = c.groupesDate || {};
      for (var k in groupes) {
        if (groupes[k].cles.indexOf(cle) !== -1) { demanderApercuDate(groupes[k]); }
      }
    }

    // ---- Aperçu de la date imprimée ------------------------------------------------------
    //
    // Sous un champ de date, la forme que le PDF imprimera, calculée par l'hôte avec le
    // formateur de la chaîne (lib/date-apercu.js) et jamais ici. La demande part 400 ms après la
    // dernière frappe, ou aussitôt à la sortie du champ ; seule la réponse au dernier jeton
    // compte. Les deux dates d'une plage (debut et fin de l'agenda) partagent une seule ligne
    // d'aperçu, sous la fin, ou sous le début si la fin est vide. Rien n'est bloqué : la
    // saisie reste libre et l'enregistrement aussi.
    function plageDuType(type) {
      var t = ctx.types().filter(function (x) { return x.valeur === type; })[0];
      return (t && Array.isArray(t.plage) && t.plage.length === 2) ? t.plage : null;
    }
    function brancherApercuDate(d, i, c, champCfg) {
      var ligneApercu = texte(d, 'p', 'doc-date-forme');
      ligneApercu.setAttribute('aria-live', 'polite');
      var plage = plageDuType(c.type);
      var dansPlage = !!plage && plage.indexOf(champCfg.cle) !== -1;
      c.groupesDate = c.groupesDate || {};
      var cleGroupe = dansPlage ? 'plage' : champCfg.cle;
      var g = c.groupesDate[cleGroupe];
      if (!g) {
        g = { carte: c, saisie: dansPlage ? 'plage' : champCfg.saisie, cles: dansPlage ? plage : [champCfg.cle],
          champs: {}, lignes: {}, jeton: null, minuteur: null, attente: null };
        c.groupesDate[cleGroupe] = g;
      }
      g.champs[champCfg.cle] = i;
      g.lignes[champCfg.cle] = ligneApercu;
      ecouterDate(g, i);
    }
    // La date d'une ligne de suivi : son propre aperçu, sous elle, hors des groupes de la carte.
    function brancherApercuDateLigne(d, i, c, cle) {
      var ligneApercu = texte(d, 'p', 'doc-date-forme');
      ligneApercu.setAttribute('aria-live', 'polite');
      var g = { carte: c, saisie: 'date', cles: [cle], champs: {}, lignes: {}, jeton: null, minuteur: null, attente: null };
      g.champs[cle] = i;
      g.lignes[cle] = ligneApercu;
      ecouterDate(g, i);
    }
    function ecouterDate(g, i) {
      i.addEventListener('input', function () {
        clearTimeout(g.minuteur);
        g.minuteur = setTimeout(function () { demanderApercuDate(g); }, DELAI_APERCU_DATE);
      });
      i.addEventListener('blur', function () { clearTimeout(g.minuteur); demanderApercuDate(g); });
    }
    // La ligne qui porte l'aperçu du groupe : sous la fin d'une plage si elle est remplie.
    function ligneApercuDate(g) {
      if (g.cles.length === 2 && String(g.champs[g.cles[1]].value || '') === '') { return g.lignes[g.cles[0]]; }
      return g.lignes[g.cles[g.cles.length - 1]];
    }
    function poserApercuDate(g, ton, contenu) {
      for (var k in g.lignes) {
        g.lignes[k].textContent = '';
        g.lignes[k].className = 'doc-date-forme';
      }
      g.cles.forEach(function (cle) { g.champs[cle].classList.remove('doc-date-champ--erreur'); });
      if (contenu === null) { return; }
      var l = ligneApercuDate(g);
      if (ton) { l.classList.add('doc-date-forme--' + ton); }
      if (ton === 'erreur') {
        g.cles.forEach(function (cle) { g.champs[cle].classList.add('doc-date-champ--erreur'); });
        l.appendChild(SZH.icone('attention'));
      }
      for (var j = 0; j < contenu.length; j++) { texte(l, 'span', null, contenu[j]); }
    }
    function demanderApercuDate(g) {
      var champs = g.cles.map(function (cle) { return g.champs[cle]; });
      clearTimeout(g.attente);
      g.jeton = null;
      if (champs.some(function (x) { return x.validity && x.validity.badInput; })) {
        poserApercuDate(g, 'indisponible', [txt().dateIncomplete || '']);
        return;
      }
      var valeursDate = champs.map(function (x) { return String(x.value || ''); });
      if (valeursDate.every(function (v) { return v === ''; })) { poserApercuDate(g, null, null); return; }
      g.jeton = ++dernierJetonDate;
      rappelsDate[g.jeton] = function (msg) { recevoirApercuDate(g, msg); };
      var jeton = g.jeton;
      g.attente = setTimeout(function () {
        if (g.jeton === jeton) { g.jeton = null; poserApercuDate(g, 'indisponible', [txt().dateIndisponible || '']); }
      }, DELAI_REPONSE_DATE);
      ctx.api.postMessage({ type: SZH.MSG.DOC_DATE_FORMER, jeton: jeton, saisie: g.saisie, valeurs: valeursDate });
    }
    function recevoirApercuDate(g, msg) {
      if (g.jeton !== msg.jeton) { return; }
      g.jeton = null;
      clearTimeout(g.attente);
      if (msg.indisponible || !msg.ok) { poserApercuDate(g, 'indisponible', [txt().dateIndisponible || '']); return; }
      var forme = SZH.remplir(txt(), 'dateImprime', [msg.forme]);
      if (!msg.erreur) { poserApercuDate(g, '', [forme]); return; }
      var cleErreur = { impossible: 'dateErreurImpossible', inversee: 'dateErreurInversee' }[msg.erreur]
        || (g.saisie === 'date_partielle' ? 'dateErreurFormatPartiel' : 'dateErreurFormat');
      var dit = SZH.remplir(txt(), cleErreur, [msg.forme]);
      // « impossible » cite déjà la forme imprimée.
      poserApercuDate(g, 'erreur', msg.erreur === 'impossible' ? [dit] : [forme, dit]);
    }

    // ---- Champ `liste_multiple` (genre et pays d'un film) : plusieurs jetons de la même liste
    //      (docs/FORMAT-DOCUMENTATION-KIRBY.md, saisie liste_multiple) --------------------------
    //
    // Deux rendus, choisis par le nombre d'options — jamais par le nom du champ (le contrat peut
    // gagner d'autres champs `liste_multiple` demain) : une petite liste (genre, neuf jetons) se
    // coche directement ; une grande (pays, 250) se cherche et se pose en étiquettes retirables,
    // triées par nom dans la langue de l'interface (typesRessourceConfig, documentation-hote.js).
    var SEUIL_LISTE_MULTIPLE_RECHERCHE = 15;

    function champListeMultipleCases(parent, c, champCfg, valeursInitiales) {
      var d = texte(parent, 'div', 'szh-champ doc-champ-liste-multiple');
      texte(d, 'span', 'doc-liste-multiple-label', champCfg.libelle || '');
      var zoneCases = texte(d, 'div', 'doc-liste-multiple-cases');
      var ctlChamp = { conteneur: d, valeurs: (valeursInitiales || []).slice() };
      c.ctl[champCfg.cle] = ctlChamp;
      function surChangement() { c.touchee = true; ctx.etat(''); ctx.majEtatCarte(c); ctx.majModifie(); ctx.surSaisie(c, champCfg.cle); }
      (champCfg.options || []).forEach(function (o) {
        var lab = texte(zoneCases, 'label', 'doc-liste-multiple-case');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = o.valeur;
        cb.checked = ctlChamp.valeurs.indexOf(o.valeur) !== -1;
        cb.addEventListener('change', function () {
          var i = ctlChamp.valeurs.indexOf(o.valeur);
          if (cb.checked && i === -1) { ctlChamp.valeurs.push(o.valeur); }
          else if (!cb.checked && i !== -1) { ctlChamp.valeurs.splice(i, 1); }
          surChangement();
        });
        lab.appendChild(cb);
        texte(lab, 'span', null, o.libelle || o.valeur);
      });
      return d;
    }

    function champListeMultipleRecherche(parent, c, champCfg, valeursInitiales) {
      var d = texte(parent, 'div', 'szh-champ doc-champ-liste-multiple');
      texte(d, 'span', 'doc-liste-multiple-label', champCfg.libelle || '');
      var ctlChamp = { conteneur: d, valeurs: (valeursInitiales || []).slice() };
      c.ctl[champCfg.cle] = ctlChamp;
      var zoneChips = texte(d, 'div', 'doc-liste-multiple-chips');
      var zoneRecherche = texte(d, 'div', 'doc-liste-multiple-recherche');
      var champTexte = document.createElement('input');
      champTexte.type = 'text';
      champTexte.placeholder = txt().listeMultipleRecherche || '';
      champTexte.className = 'doc-liste-multiple-champ-recherche';
      zoneRecherche.appendChild(champTexte);
      var listeResultats = texte(zoneRecherche, 'div', 'doc-liste-multiple-resultats');
      listeResultats.hidden = true;

      function libelleDe(valeur) {
        var o = (champCfg.options || []).filter(function (x) { return x.valeur === valeur; })[0];
        return o ? o.libelle : valeur;
      }
      function surChangement() { c.touchee = true; ctx.etat(''); ctx.majEtatCarte(c); ctx.majModifie(); ctx.surSaisie(c, champCfg.cle); }
      function rendreChips() {
        zoneChips.textContent = '';
        ctlChamp.valeurs.forEach(function (v) {
          var chip = texte(zoneChips, 'span', 'doc-liste-multiple-chip');
          texte(chip, 'span', null, libelleDe(v));
          chip.appendChild(boutonIcone('poubelle', txt().listeMultipleRetirerTip || '', function () { retirer(v); }, 'szh-ico--danger'));
        });
      }
      function retirer(valeur) {
        var i = ctlChamp.valeurs.indexOf(valeur);
        if (i !== -1) { ctlChamp.valeurs.splice(i, 1); }
        rendreChips();
        surChangement();
      }
      function ajouter(valeur) {
        if (ctlChamp.valeurs.indexOf(valeur) === -1) { ctlChamp.valeurs.push(valeur); }
        champTexte.value = '';
        rendreResultats('');
        rendreChips();
        surChangement();
        try { champTexte.focus(); } catch (e) { /* environnement sans focus (tests) */ }
      }
      function rendreResultats(requete) {
        listeResultats.textContent = '';
        var q = String(requete || '').trim().toLowerCase();
        if (q === '') { listeResultats.hidden = true; return; }
        var options = (champCfg.options || []).filter(function (o) {
          return ctlChamp.valeurs.indexOf(o.valeur) === -1 && o.libelle.toLowerCase().indexOf(q) !== -1;
        }).slice(0, 30);
        if (options.length === 0) {
          texte(listeResultats, 'p', 'doc-vue-vide', txt().listeMultipleAucunResultat || '');
          listeResultats.hidden = false;
          return;
        }
        options.forEach(function (o) {
          var item = document.createElement('button');
          item.type = 'button';
          item.className = 'doc-liste-multiple-resultat';
          item.textContent = o.libelle;
          // mousedown, pas click : précède le blur du champ texte, sinon la liste se cache
          // avant que le clic ne l'atteigne.
          item.addEventListener('mousedown', function (ev) { ev.preventDefault(); ajouter(o.valeur); });
          listeResultats.appendChild(item);
        });
        listeResultats.hidden = false;
      }
      champTexte.addEventListener('input', function () { rendreResultats(champTexte.value); });
      champTexte.addEventListener('focus', function () { if (champTexte.value.trim() !== '') { rendreResultats(champTexte.value); } });
      champTexte.addEventListener('blur', function () {
        try { setTimeout(function () { listeResultats.hidden = true; }, 120); }
        catch (e) { listeResultats.hidden = true; }
      });
      rendreChips();
      return d;
    }

    function champListeMultiple(parent, c, champCfg, valeursInitiales) {
      var options = champCfg.options || [];
      if (options.length > SEUIL_LISTE_MULTIPLE_RECHERCHE) { return champListeMultipleRecherche(parent, c, champCfg, valeursInitiales); }
      return champListeMultipleCases(parent, c, champCfg, valeursInitiales);
    }

    // Un champ visible seulement si `quand` est satisfait : la carte suit dès la construction,
    // et à chaque changement (majConditionnels ci-dessus).
    function champ(parent, c, champCfg, valeursInitiales) {
      var conteneur;
      if (champCfg.saisie === 'structure') { conteneur = champStructure(parent, c, champCfg, valeursInitiales && valeursInitiales[champCfg.cle]); }
      else if (champCfg.saisie === 'liste_multiple') { conteneur = champListeMultiple(parent, c, champCfg, valeursInitiales && valeursInitiales[champCfg.cle]); }
      else if (champCfg.saisie === 'derive') { conteneur = champDerive(parent, c, champCfg); }
      else if (champCfg.saisie === 'fichier') { conteneur = champFichier(parent, c, champCfg); }
      else { conteneur = champOrdinaire(parent, c, champCfg); }
      if (champCfg.saisie !== 'fichier' && valeursInitiales) {
        var v0 = valeursInitiales[champCfg.cle];
        if (champCfg.saisie === 'liste') { poserOptions(c.ctl[champCfg.cle], champCfg.options || [], String(v0 || '')); }
        else if (champCfg.saisie === 'structure' || champCfg.saisie === 'derive' || champCfg.saisie === 'liste_multiple') { /* déjà posées */ }
        else if (champCfg.saisie === 'date') {
          if (poserValeurDate(c.ctl[champCfg.cle], String(v0 || ''))) { demanderApercuDesDates(c, champCfg.cle); }
        }
        else { c.ctl[champCfg.cle].value = String(v0 || ''); }
      }
      if (champCfg.quand) {
        c.conditionnels = c.conditionnels || [];
        c.conditionnels.push({ conteneur: conteneur, quand: champCfg.quand });
      }
      return conteneur;
    }

    return {
      champ: champ, valeurChamp: valeurChamp, valeursFiche: valeursFiche, quandSatisfait: quandSatisfait,
      champsManquants: champsManquants, lireStructure: lireStructure, poserOptions: poserOptions,
      poserValeurDate: poserValeurDate, majConditionnels: majConditionnels, majDerives: majDerives,
      rafraichirDependants: rafraichirDependants
    };
  }

  SZH.ficheDoc = { creer: creer, recevoirDate: recevoirDate, former: former };
})();
