// Cartes de métadonnées d'article et modale photo, partagées par « Métadonnées des
// articles » et « Vérification de l'import ». Posé après _commun.js, et seulement sur ces
// deux pages : les autres webviews n'en ont pas l'usage.
//
//   SZH.cartesArticles(opts)  construit et pilote les cartes d'un conteneur,
//                             l'enregistrement et l'affichage des traductions
//
// Les auteur·e·s sont affichés et édités par SZH.auteurs (media/_auteurs.js), partagé avec
// le gestionnaire des médias : leur fiche et leur modale ne sont décrites qu'une fois.

(function () {
  'use strict';

  // ---- Cartes de métadonnées d'article ----
  //
  // La carte (type, langue, licence, titres, sous-titres, résumés, auteurs, DOI,
  // mots-clés) et la modale photo, partagées par « Métadonnées des articles » et
  // « Vérification de l'import ».
  // Les deux pages ne diffèrent que par des décorations : la seconde pose un badge sur
  // chaque intitulé et un compteur de champs vides. D'où `decor`, dont tous les crochets
  // sont facultatifs :
  //
  //   titre(h2, slug)                 remplit l'en-tête de la carte
  //   champ(label, champId)           décore l'intitulé d'un champ
  //   motsCles(label, langues, noms)  décore l'intitulé du bloc de mots-clés
  //   finCarte(carte, article)        carte construite et insérée
  //   carteChangee(carte)             une colonne de langue vient d'être (dé)cochée, ou
  //                                   la langue de l'article a changé
  //   marque(carte, slug)             une carte vient d'être marquée modifiée
  //
  // `surChangement()` est appelé quand l'ensemble des cartes modifiées change, y compris
  // au re-rendu qui le vide. `surValeurs(msg)` l'est après le rendu d'un message
  // « valeurs », pour ce que la page ajoute autour des cartes. `traductionsVisibles`
  // ouvre les langues dès le départ, ce dont la vérification d'import a besoin : ses
  // badges « à compléter » vivent dans les intitulés, traductions comprises.
  //
  // Protocole avec l'hôte :
  //   hôte -> webview : valeurs { articles, types, licences, licenceDefaut, langue, accent } ;
  //                     doi-manuel-reponse { slug, sens, ok } ;
  //                     mots-cles-connus { motsCles: [{ de, fr }] } (autocomplétion, voir
  //                     attacherAutocompletionMotsCles plus bas)
  //   webview -> hôte : doi-manuel-confirmer { slug, sens }
  // La partie photo est celle de _auteurs.js, à qui les messages sont passés.

  // ---- Autocomplétion des mots-clés : le vocabulaire edudoc.ch (lib/mots-cles-edudoc.js) --
  //
  // Reçu de l'hôte en paires bilingues { de, fr } (message mots-cles-connus). La grille de
  // mots-clés (SZH.motsCles, _commun.js) apparie déjà « diagnostic » et « Diagnose » PAR
  // POSITION — une rangée est un mot-clé, une colonne par langue — et c'est cette même
  // règle qui gouverne l'autocomplétion : on propose dans la langue du champ où l'on
  // tape (son data-langue), jamais dans une autre. Choisir une suggestion complète en
  // plus — SEULEMENT si elle est vide — la case de l'AUTRE langue sur la MÊME rangée avec
  // l'équivalent que le thésaurus bilingue connaît déjà : la paire edudoc.ch (de, fr) est
  // justement ce qui relie « Sonderpädagogik » à « pédagogie spécialisée », et la grille du
  // formulaire relie ses colonnes de la même façon, par position. Une correction déjà
  // tapée n'est jamais effacée (même règle que les champs enrichis des auteur·e·s,
  // media/_auteurs.js).
  //
  // Aucun vocabulaire italien : lib/mots-cles-edudoc.js ne moissonne que DE/FR (les deux
  // revues n'y publient pas en italien). Le champ `it` de la grille ne déclenche donc
  // jamais de suggestion, et ne reçoit jamais d'équivalent complété — plutôt que de
  // proposer du français à qui tape en italien.
  //
  // Les paires incomplètes (« manque » côté hôte) ne sont simplement jamais indexées dans
  // la langue qui leur manque : pDe/pFr valent alors null, et chercherMotsCles les saute.
  //
  // Posée en DÉLÉGATION sur le conteneur de la grille (editeurMots.element), qui n'est
  // jamais remplacé : SZH.motsCles reconstruit tout son DOM interne à chaque ajout, retrait
  // ou permutation de rangée (voir son commentaire « Reconstruit le DOM depuis le modèle,
  // sans jamais le relire »), et un écouteur posé sur un <input> précis serait perdu à la
  // reconstruction suivante.

  // Casse et accents pliés, comme pour les auteur·e·s (media/_auteurs.js) : « special »
  // trouve « spécialisée ».
  function plierMc(t) {
    var s = String(t === undefined || t === null ? '' : t).toLowerCase().replace(/\s+/g, ' ').trim();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }
    catch (e) { /* moteur sans normalize : filtrage sensible aux accents, sans casser */ }
    return s;
  }

  // Comme plierAvecIndex de _auteurs.js : la forme pliée ET l'indice, dans l'original, du
  // caractère dont chaque caractère plié vient — pour mettre en gras la bonne portion du
  // texte d'origine, quoi qu'invente Unicode sur un caractère replié.
  function plierAvecIndexMc(brut) {
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

  // Ce qui sépare deux mots dans un descripteur — l'espace, le trait d'union, la virgule :
  // « troubles, difficultés » doit se chercher mot à mot.
  var SEPARE_MC = /[\s\-'’.,;]/;
  function debutsDeMotMc(plie) {
    var debuts = [];
    for (var i = 0; i < plie.length; i++) {
      if (SEPARE_MC.test(plie.charAt(i))) { continue; }
      if (i === 0 || SEPARE_MC.test(plie.charAt(i - 1))) { debuts.push(i); }
    }
    return debuts;
  }
  // Le premier début de mot à partir duquel `q` se lit tel quel, ou -1.
  function chercherDebutMc(pli, debuts, q) {
    for (var i = 0; i < debuts.length; i++) {
      if (pli.plie.lastIndexOf(q, debuts[i]) === debuts[i]) { return debuts[i]; }
    }
    return -1;
  }
  // Pose un texte dans `parent`, les parts trouvées en gras. Rien n'est construit en HTML :
  // un descripteur est une donnée, pas du balisage.
  function poserAvecGrasMc(parent, pli, zones) {
    var brut = pli.source;
    var pose = 0;
    for (var z = 0; z < zones.length; z++) {
      var i0 = pli.index[zones[z][0]];
      var fin = zones[z][0] + zones[z][1];
      var i1 = (fin < pli.index.length) ? pli.index[fin] : brut.length;
      if (i0 < pose) { continue; }
      if (i0 > pose) { parent.appendChild(document.createTextNode(brut.slice(pose, i0))); }
      var fort = document.createElement('strong');
      fort.textContent = brut.slice(i0, i1);
      parent.appendChild(fort);
      pose = i1;
    }
    if (pose < brut.length) { parent.appendChild(document.createTextNode(brut.slice(pose))); }
  }

  // Les paires reçues de l'hôte, indexées une fois pour la recherche : pDe/pFr valent null
  // pour le côté manquant d'une paire incomplète, et chercherMotsCles les saute alors.
  function construireIndexMotsCles(liste) {
    var connus = [];
    for (var i = 0; i < (liste || []).length; i++) {
      var m = liste[i] || {};
      var de = String(m.de || '').replace(/\s+/g, ' ').trim();
      var fr = String(m.fr || '').replace(/\s+/g, ' ').trim();
      if (de === '' && fr === '') { continue; }
      var e = { de: de, fr: fr, pDe: null, pFr: null };
      if (de !== '') { e.pDe = plierAvecIndexMc(de); e.pDe.debuts = debutsDeMotMc(e.pDe.plie); }
      if (fr !== '') { e.pFr = plierAvecIndexMc(fr); e.pFr.debuts = debutsDeMotMc(e.pFr.plie); }
      connus.push(e);
    }
    return connus;
  }

  var MC_SUGG_MAX = 8;               // au-delà, ce n'est plus un menu mais une liste

  // Les entrées qui correspondent à la saisie, pour un CODE DE LANGUE donné ('fr' ou 'de' —
  // jamais 'it', voir plus haut). Une saisie de plusieurs mots doit tous les retrouver,
  // chacun au début d'un mot du descripteur.
  function chercherMotsCles(connus, langueCode, saisie) {
    var trouves = [];
    var mots = saisie.split(' ').filter(function (m) { return m !== ''; });
    for (var i = 0; i < connus.length; i++) {
      var e = connus[i];
      var pli = langueCode === 'fr' ? e.pFr : e.pDe;
      if (!pli) { continue; }                      // paire incomplète dans cette langue
      var zones = [];
      var ok = true;
      for (var m = 0; m < mots.length; m++) {
        var d = chercherDebutMc(pli, pli.debuts, mots[m]);
        if (d === -1) { ok = false; break; }
        zones.push([d, mots[m].length]);
      }
      if (ok) {
        zones.sort(function (a, b) { return a[0] - b[0]; });
        trouves.push({ entree: e, pli: pli, zones: zones });
      }
    }
    trouves.sort(function (a, b) {
      var ta = langueCode === 'fr' ? a.entree.fr : a.entree.de;
      var tb = langueCode === 'fr' ? b.entree.fr : b.entree.de;
      return plierMc(ta).localeCompare(plierMc(tb));
    });
    return trouves.slice(0, MC_SUGG_MAX);
  }

  function cartesArticles(opts) {
    var conteneur = opts.conteneur;
    var api = opts.api;
    var TXT = opts.txt;
    var etat = opts.etat;
    var decor = opts.decor || {};
    var surChangement = opts.surChangement || function () {};
    var surValeurs = opts.surValeurs || function () {};
    var appeler = function (nom, a, b, c) { if (decor[nom]) { decor[nom](a, b, c); } };

    var modifies = new Set();
    var motsClesParCarte = new WeakMap();
    var doiParCarte = new WeakMap();               // carte -> { poser, calcule } du champ DOI
    // Les auteur·e·s d'une carte ne vivent plus dans le DOM : la fiche affichée est
    // statique, et c'est ce modèle que la modale édite et que collecter() relit.
    var auteursParCarte = new WeakMap();
    var apercusParCarte = new WeakMap();
    var TYPES = [];
    var LANGUE_DEFAUT = 'fr';
    // Licences offertes et licence par défaut : listes fermées venues de l'hôte, comme
    // les types d'article. Le formulaire n'en connaît aucune de son côté.
    var LICENCES = [];
    var LICENCE_DEFAUT = '';
    // Le vocabulaire edudoc.ch (message mots-cles-connus), partagé par toutes les cartes
    // de la page — une seule liste, comme TYPES et LICENCES.
    var motsClesConnus = [];
    function poserMotsClesConnus(liste) { motsClesConnus = construireIndexMotsCles(liste); }

    // La modale rend l'auteur·e édité ; il n'est pas écrit sur le disque tout de suite,
    // la carte gardant la main sur son enregistrement — c'est la seule chose que cette
    // page apporte au composant partagé.
    var ctlAuteurs = SZH.auteurs({
      api: api,
      txt: TXT,
      // La première frappe marque la carte : sans cela, un rechargement demandé ailleurs
      // — l'icône ✎ d'un autre article — jetterait les six champs de la modale sans un mot,
      // la garde de l'hôte ne connaissant que les cartes marquées.
      surSaisie: function (fiche) { marquer(fiche.carte, fiche.slug); },
      persister: function (fiche, auteur, fini) {
        var liste = auteursParCarte.get(fiche.carte) || [];
        if (fiche.index >= liste.length) { liste.push({}); }
        liste[fiche.index] = auteur;
        auteursParCarte.set(fiche.carte, liste);
        if (fiche.apercu !== undefined) { fiche.apercus[fiche.index] = fiche.apercu; }
        rendreAuteurs(fiche.carte, fiche.slug, fiche.index);
        marquer(fiche.carte, fiche.slug);
        fini(null);
      }
    });

    function marquer(carte, slug) {
      modifies.add(slug);
      carte.classList.add('modifie');
      if (etat) { etat.textContent = ''; }
      surChangement();
      appeler('marque', carte, slug);
    }

    // `traduction` marque les champs d'une autre langue que celle de l'ARTICLE : ils sont
    // cachés par défaut, et révélés par le bouton de la barre. Une fiche se remplit
    // d'abord dans sa langue ; tout afficher d'emblée triplait la hauteur de la carte.
    function champTexte(carte, parent, slug, cle, langue, libelle, valeur, multiligne, traduction) {
      var l = document.createElement('label');
      l.textContent = libelle;
      appeler('champ', l, langue ? cle + '.' + langue : cle);
      var i = document.createElement(multiligne ? 'textarea' : 'input');
      if (multiligne) { i.rows = 3; } else { i.type = 'text'; }
      i.value = valeur || '';
      i.dataset.cle = cle;
      if (langue) { i.dataset.langue = langue; l.classList.add('champ-' + langue); i.classList.add('champ-' + langue); }
      if (traduction) { l.classList.add('champ-trad'); i.classList.add('champ-trad'); }
      i.addEventListener('input', function () { marquer(carte, slug); });
      parent.appendChild(l);
      parent.appendChild(i);
    }

    // ---- Le champ DOI : calculé et verrouillé, sauf échappatoire ----
    //
    // Le DOI ne se saisit plus : l'hôte envoie le calculé (article.doiCalcule) et le champ
    // l'affiche en lecture seule — « — » quand il est incalculable ou que l'article n'en
    // reçoit pas. La case « Définir manuellement le DOI » reste l'échappatoire ; la webview
    // n'a pas de boîte de dialogue, la confirmation passe donc par l'hôte :
    //
    //   webview -> hôte : doi-manuel-confirmer { slug, sens: 'activer' | 'retirer' }
    //   hôte -> webview : doi-manuel-reponse { slug, sens, ok }
    //
    // La case revient en arrière dès le clic et la réponse rejoue le geste : entre les
    // deux, l'utilisateur lit la question modale de l'hôte. Une fiche qui porte déjà un
    // doi est en mode manuel d'office — l'héritage d'avant le verrou ne se perd pas.
    function champDoi(carte, slug, article) {
      var v = article.valeurs || {};
      var calcule = String(article.doiCalcule || '').trim();
      var manuel = String(v.doi || '').trim() !== '';
      var l = document.createElement('label');
      l.textContent = 'DOI';
      var i = document.createElement('input');
      i.type = 'text';
      i.dataset.cle = 'doi';
      i.addEventListener('input', function () { marquer(carte, slug); });
      var caseDoi = document.createElement('label');
      caseDoi.className = 'case-doi';
      var coche = document.createElement('input');
      coche.type = 'checkbox';
      coche.dataset.cle = 'doi-manuel';
      caseDoi.appendChild(coche);
      caseDoi.appendChild(document.createTextNode(TXT.doiManuel));
      function poser(actif, valeur) {
        coche.checked = actif;
        i.readOnly = !actif;
        i.classList.toggle('doi-verrouille', !actif);
        i.title = actif ? '' : TXT.doiVerrouTip;
        i.value = actif ? valeur : (calcule !== '' ? calcule : '–');
      }
      poser(manuel, v.doi || '');
      coche.addEventListener('change', function () {
        var veut = coche.checked;
        // Décocher un champ resté au calculé (ou vide) n'efface rien : pas de question.
        if (!veut && (i.value.trim() === '' || i.value.trim() === calcule)) {
          poser(false, '');
          marquer(carte, slug);
          return;
        }
        coche.checked = !veut;                     // en arrière, jusqu'à la réponse
        if (carte.dataset.attenteDoi) { return; }  // une question est déjà posée
        carte.dataset.attenteDoi = '1';
        api.postMessage({ type: 'doi-manuel-confirmer', slug: slug,
          sens: veut ? 'activer' : 'retirer' });
      });
      doiParCarte.set(carte, { poser: poser, calcule: calcule });
      carte.appendChild(l);
      carte.appendChild(i);
      carte.appendChild(caseDoi);
    }

    // La réponse de l'hôte à la question modale. Refus (ok: false) : la case est déjà
    // revenue en arrière, il n'y a rien à faire. Accord : le champ s'ouvre prérempli du
    // calculé — point de départ raisonnable — ou se referme en effaçant le DOI manuel.
    function reponseDoi(msg) {
      var slug = String(msg.slug || '');
      var carte = null;
      for (var c of conteneur.querySelectorAll('.carte')) {
        if (c.dataset.slug === slug) { carte = c; break; }
      }
      if (!carte) { return; }
      delete carte.dataset.attenteDoi;
      var ctl = doiParCarte.get(carte);
      if (!ctl || !msg.ok) { return; }
      if (msg.sens === 'retirer') { ctl.poser(false, ''); }
      else { ctl.poser(true, ctl.calcule); }
      marquer(carte, slug);
    }

    // ---- Autocomplétion des mots-clés : posée une fois par carte, sur le conteneur ----
    //
    // En délégation (voir le commentaire de tête du fichier) : un seul écouteur par
    // événement, qui survit à toutes les reconstructions internes de SZH.motsCles.
    function attacherAutocompletionMotsCles(editeurMots) {
      var conteneurMc = editeurMots.element;
      var boiteSugg = document.createElement('div');
      boiteSugg.className = 'mc-sugg';
      boiteSugg.hidden = true;
      boiteSugg.setAttribute('role', 'listbox');
      boiteSugg.setAttribute('aria-label', TXT.motsClesSuggestions || '');
      var suggEtat = { input: null, items: [], actif: -1 };
      var enSelection = false;               // vrai pendant qu'on écrit nous-mêmes une valeur

      function fermerSuggestions() {
        boiteSugg.hidden = true;
        boiteSugg.textContent = '';
        boiteSugg.remove();
        suggEtat = { input: null, items: [], actif: -1 };
      }

      function poserActif(n) {
        var total = suggEtat.items.length;
        if (total === 0) { return; }
        var idx = ((n % total) + total) % total;     // les flèches bouclent aux extrémités
        for (var k = 0; k < total; k++) {
          suggEtat.items[k].element.classList.toggle('actif', k === idx);
          suggEtat.items[k].element.setAttribute('aria-selected', k === idx ? 'true' : 'false');
        }
        suggEtat.actif = idx;
      }

      // Choisir une suggestion écrase toujours le champ où l'on tape, et complète en plus
      // — SEULEMENT si elle est vide — la case de l'AUTRE langue sur la MÊME rangée : voir
      // le commentaire de tête du fichier pour la justification de ce choix.
      function choisir(trouve, langueCode, input) {
        enSelection = true;
        var e = trouve.entree;
        input.value = langueCode === 'fr' ? e.fr : e.de;
        // Un événement synthétique : c'est lui que SZH.motsCles écoute pour absorber la
        // valeur dans son modèle et prévenir onChange (qui marque la carte modifiée) — une
        // affectation directe de .value ne suffirait pas, aucun écouteur natif n'en saurait
        // rien.
        input.dispatchEvent(new Event('input', { bubbles: true }));
        var autreCode = langueCode === 'fr' ? 'de' : 'fr';
        var valeurAutre = langueCode === 'fr' ? e.de : e.fr;
        var rangee = input.closest('.mc-rangee');
        var champAutre = (valeurAutre !== '' && rangee)
          ? rangee.querySelector('input[data-langue="' + autreCode + '"]') : null;
        if (champAutre && champAutre.value.trim() === '') {
          champAutre.value = valeurAutre;
          champAutre.dispatchEvent(new Event('input', { bubbles: true }));
        }
        enSelection = false;
        fermerSuggestions();
      }

      function majSuggestions(input) {
        if (enSelection) { return; }                 // écriture programmatique : pas de boîte
        var langueCode = input.dataset.langue;
        // L'italien n'a pas de vocabulaire edudoc.ch : rien à proposer plutôt que du
        // français, voir le commentaire de tête du fichier.
        if (langueCode !== 'fr' && langueCode !== 'de') { fermerSuggestions(); return; }
        var saisie = plierMc(input.value);
        if (motsClesConnus.length === 0 || saisie.length < 2) { fermerSuggestions(); return; }
        var trouves = chercherMotsCles(motsClesConnus, langueCode, saisie);
        fermerSuggestions();
        if (trouves.length === 0) { return; }
        var rangee = input.closest('.mc-rangee');
        if (!rangee) { return; }
        suggEtat = { input: input, items: [], actif: -1 };
        for (var i = 0; i < trouves.length; i++) {
          (function (t) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'mc-sugg-item';
            b.setAttribute('role', 'option');
            b.setAttribute('aria-selected', 'false');
            poserAvecGrasMc(b, t.pli, t.zones);
            // mousedown neutralisé : le clic ne doit pas d'abord voler le focus du champ.
            b.addEventListener('mousedown', function (e) { e.preventDefault(); });
            b.addEventListener('click', function () { choisir(t, langueCode, input); });
            boiteSugg.appendChild(b);
            suggEtat.items.push({ element: b, trouve: t });
          })(trouves[i]);
        }
        // Positionnée sous LA CASE où l'on tape, pas sous la rangée entière qui couvre
        // plusieurs langues : .mc-rangee est en position relative (_fiches.css), et l'input
        // en est un enfant direct — son offsetLeft/offsetWidth suffisent.
        boiteSugg.style.left = input.offsetLeft + 'px';
        boiteSugg.style.width = input.offsetWidth + 'px';
        rangee.appendChild(boiteSugg);
        boiteSugg.hidden = false;
      }

      function clavierSuggestions(e, input) {
        if (boiteSugg.hidden || suggEtat.input !== input) { return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); poserActif(suggEtat.actif + 1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); poserActif(suggEtat.actif - 1); return; }
        if (e.key === 'Enter') {
          if (suggEtat.actif >= 0 && suggEtat.items[suggEtat.actif]) {
            e.preventDefault();
            choisir(suggEtat.items[suggEtat.actif].trouve, input.dataset.langue, input);
          }
          return;
        }
        if (e.key === 'Escape') {
          // Seule la liste se ferme — la propagation est coupée, par cohérence avec
          // l'autocomplétion des auteur·e·s (media/_auteurs.js).
          e.preventDefault();
          if (e.stopPropagation) { e.stopPropagation(); }
          fermerSuggestions();
        }
      }

      conteneurMc.addEventListener('input', function (e) {
        var input = e.target;
        if (!input || input.tagName !== 'INPUT' || !input.dataset.langue) { return; }
        majSuggestions(input);
      });
      conteneurMc.addEventListener('keydown', function (e) {
        var input = e.target;
        if (!input || input.tagName !== 'INPUT' || !input.dataset.langue) { return; }
        clavierSuggestions(e, input);
      });
      // focusout (et non blur) : il remonte jusqu'au conteneur, où l'écouteur est posé en
      // délégation. Le mousedown neutralisé sur chaque suggestion garde le focus sur le
      // champ le temps du clic, comme pour les auteur·e·s.
      conteneurMc.addEventListener('focusout', function () { fermerSuggestions(); });
    }

    // ---- Construction des cartes ----

    function rendre(articles, types, langueDefaut, licences, licenceDefaut) {
      if (types) { TYPES = types; }
      if (langueDefaut) { LANGUE_DEFAUT = langueDefaut; }
      if (licences) { LICENCES = licences; }
      if (licenceDefaut) { LICENCE_DEFAUT = licenceDefaut; }
      ctlAuteurs.fermer();                           // re-rendu : la fiche visée disparaît
      conteneur.textContent = '';
      modifies.clear();
      surChangement();
      for (var n = 0; n < articles.length; n++) {
        var carte = construireCarte(articles[n]);
        conteneur.appendChild(carte);
        appeler('finCarte', carte, articles[n]);
      }
    }

    function construireCarte(article) {
      var slug = article.slug;
      var carte = document.createElement('div');
      carte.className = 'carte szh-carte';
      carte.dataset.slug = slug;
      var titre = document.createElement('h2');
      if (decor.titre) { decor.titre(titre, slug); } else { titre.textContent = slug; }
      carte.appendChild(titre);
      var v = article.valeurs || {};

      // ---- Les langues de la carte ----
      //
      // L'ordre d'affichage suit l'ARTICLE : sa langue d'abord, puis la langue par défaut
      // de la revue (FR pour la Revue, DE pour la Zeitschrift) comme langue de
      // traduction. Les langues restantes de {fr, de, it} sont les « manquantes » : une
      // case à cocher chacune, cochée d'office quand la fiche porte déjà des contenus
      // dans cette langue. Tous les champs sont toujours construits, dans cet ordre ; le
      // CSS ne révèle que les langues dont la carte porte la classe avec-<lang>.
      // Une fiche sans `lang` s'affiche sous la langue du numéro, exactement le repli du
      // sélecteur et de szh-maquette.lua.
      var ORDRE_LANGUES = ['fr', 'de', 'it'];
      var noms = { fr: 'FR', de: 'DE', it: 'IT' };
      var langueRevueDefaut = ORDRE_LANGUES.indexOf(LANGUE_DEFAUT) !== -1 ? LANGUE_DEFAUT : 'fr';
      var langueArticle = ORDRE_LANGUES.indexOf(v.lang) !== -1 ? v.lang : langueRevueDefaut;
      var champsMultilingues = ['title', 'subtitle', 'resume'];

      function languesBase() {
        return langueArticle === langueRevueDefaut
          ? [langueArticle] : [langueArticle, langueRevueDefaut];
      }
      function languesManquantes() {
        var base = languesBase();
        return ORDRE_LANGUES.filter(function (l) { return base.indexOf(l) === -1; });
      }
      function ordreAffichage() { return languesBase().concat(languesManquantes()); }
      function languesVisibles() {
        return languesBase().concat(
          languesManquantes().filter(function (l) { return !!cochees[l]; }));
      }
      function poserClasses() {
        var visibles = languesVisibles();
        for (var i = 0; i < ORDRE_LANGUES.length; i++) {
          carte.classList.toggle('avec-' + ORDRE_LANGUES[i],
            visibles.indexOf(ORDRE_LANGUES[i]) !== -1);
        }
      }
      // L'héritage : une langue manquante qui a déjà des contenus s'affiche d'office.
      var cochees = {};
      languesManquantes().forEach(function (lg) {
        cochees[lg] = champsMultilingues.some(function (c) { return v[c] && v[c][lg]; }) ||
          !!(v.keywords && v.keywords[lg] && v.keywords[lg].length > 0);
      });

      var lType = document.createElement('label');
      lType.textContent = TXT.type;
      appeler('champ', lType, 'type');
      carte.appendChild(lType);
      var selection = document.createElement('select');
      selection.dataset.cle = 'type';
      var optVide = document.createElement('option');
      optVide.value = '';
      optVide.textContent = TXT.typeAucun;
      selection.appendChild(optVide);
      var cible = selection, groupeCourant = null;
      for (var t = 0; t < TYPES.length; t++) {
        var type = TYPES[t];
        if (type.groupe) {
          if (type.groupe !== groupeCourant) {
            groupeCourant = type.groupe;
            cible = document.createElement('optgroup');
            cible.label = type.groupe;
            selection.appendChild(cible);
          }
        } else { cible = selection; groupeCourant = null; }
        var opt = document.createElement('option');
        opt.value = type.valeur;
        opt.textContent = type.libelle;
        cible.appendChild(opt);
      }
      selection.value = v.type || '';
      if (selection.value !== (v.type || '')) { selection.value = ''; }
      selection.addEventListener('input', function () { marquer(carte, slug); });
      carte.appendChild(selection);

      // Langue de l'article : elle prime au rendu sur celle du numéro. Le <select> vient
      // de SZH.choixLangue (_commun.js), une seule description pour les deux formulaires.
      // La changer PERMUTE les contenus entre l'ancienne et la nouvelle langue — voir
      // changerLangue() plus bas.
      var langue = SZH.choixLangue({
        valeur: v.lang, defaut: LANGUE_DEFAUT,
        textes: { libelle: TXT.langueArticle, fr: TXT.langueFr, de: TXT.langueDe, it: TXT.langueIt },
        onChange: function (nouvelle) { changerLangue(nouvelle); }
      });
      appeler('champ', langue.label, 'lang');
      carte.appendChild(langue.label);
      carte.appendChild(langue.select);

      // Licence de l'article : CC-BY 4.0 sauf mention contraire, et c'est ici qu'une
      // reprise sous droits se déclare. Même composant que la langue, à liste et libellés
      // près, qui viennent de l'hôte.
      var licence = SZH.choixFerme({
        cle: 'licence', libelle: TXT.licence, options: LICENCES,
        valeur: v.licence, defaut: LICENCE_DEFAUT,
        onChange: function () { marquer(carte, slug); }
      });
      appeler('champ', licence.label, 'licence');
      carte.appendChild(licence.label);
      carte.appendChild(licence.select);

      // Les champs multilingues vivent dans leur propre zone, reconstruite au changement
      // de langue : la langue de l'article vient en premier, les autres en dessous.
      var textes = [['title', TXT.titreChamp, false], ['subtitle', TXT.sousTitre, false],
        ['resume', TXT.resume, true]];
      var zoneTextes = document.createElement('div');
      zoneTextes.className = 'champs-textes';
      carte.appendChild(zoneTextes);
      function rendreChampsTextes(valeurs) {
        zoneTextes.textContent = '';
        var langues = ordreAffichage();
        for (var c = 0; c < textes.length; c++) {
          for (var g = 0; g < langues.length; g++) {
            var lg = langues[g];
            champTexte(carte, zoneTextes, slug, textes[c][0], lg,
              textes[c][1].split('{0}').join(noms[lg]),
              (valeurs[textes[c][0]] || {})[lg], textes[c][2], lg !== langueArticle);
          }
        }
      }
      rendreChampsTextes(v);

      var lAuteurs = document.createElement('label');
      lAuteurs.textContent = TXT.auteurs;
      appeler('champ', lAuteurs, 'auteurs');
      carte.appendChild(lAuteurs);
      var zone = document.createElement('div');
      zone.className = 'auteurs';
      carte.appendChild(zone);
      auteursParCarte.set(carte, (v.author || []).map(function (a) { return a; }));
      apercusParCarte.set(carte, (article.apercusAuteurs || []).slice());
      rendreAuteurs(carte, slug);

      champDoi(carte, slug, article);

      // Mots-clés : on ajoute et on retire une rangée entière, jamais un mot dans une
      // seule langue, la position seule appariant « diagnostic » et « Diagnose ».
      var lMots = document.createElement('label');
      lMots.textContent = TXT.motsClesTitre || '';
      appeler('motsCles', lMots, ordreAffichage(), noms);
      carte.appendChild(lMots);
      var colonnes = function () {
        return languesVisibles().map(function (l) { return { code: l, libelle: noms[l] }; });
      };
      // SZH.motsCles : la grille vit dans _commun.js, un autre IIFE. L'appeler sans le
      // préfixe levait une ReferenceError au premier bloc de mots-clés — donc à chaque
      // carte, donc sur les deux formulaires, qui s'ouvraient vides sans un mot.
      var editeurMots = SZH.motsCles({
        langues: colonnes(),
        listes: v.keywords || {},
        edition: true,
        textes: {
          motCle: TXT.motsCles, ajouter: TXT.motCleAjouter,
          retirer: TXT.motCleRetirer
        },
        onChange: function () { marquer(carte, slug); }
      });
      motsClesParCarte.set(carte, editeurMots);
      carte.appendChild(editeurMots.element);
      attacherAutocompletionMotsCles(editeurMots);

      // Une case par langue MANQUANTE : « + Allemand (champs DE) » pour un article IT de
      // la Revue, « + Français » et « + Italien » pour un article DE de la Zeitschrift.
      // Cocher révèle la colonne ; rien n'est marqué modifié — les valeurs ne bougent pas.
      var libellesAjout = { fr: TXT.ajoutFr, de: TXT.ajoutDe, it: TXT.ajoutIt };
      var zoneCases = document.createElement('div');
      zoneCases.className = 'cases-langues';
      carte.appendChild(zoneCases);
      function rendreCases() {
        zoneCases.textContent = '';
        languesManquantes().forEach(function (lg) {
          var caseLangue = document.createElement('label');
          caseLangue.className = 'case-langue';
          var coche = document.createElement('input');
          coche.type = 'checkbox';
          coche.dataset.langue = lg;
          coche.checked = !!cochees[lg];
          caseLangue.appendChild(coche);
          caseLangue.appendChild(document.createTextNode(libellesAjout[lg] || lg));
          coche.addEventListener('change', function () {
            cochees[lg] = coche.checked;
            poserClasses();
            // La colonne apparaît ou disparaît ; le fragment garde ses valeurs, qui
            // vivent dans son modèle et non dans le DOM.
            editeurMots.reconstruire(colonnes());
            appeler('carteChangee', carte);
          });
          zoneCases.appendChild(caseLangue);
        });
      }
      rendreCases();
      poserClasses();

      // Changer la langue de l'article PERMUTE les contenus entre l'ancienne et la
      // nouvelle langue — titres, sous-titres, résumés et mots-clés : rien ne se perd,
      // les textes de l'ancienne langue passent sous la nouvelle et inversement. Une
      // fiche sans langue déclarée s'affiche sous la langue du numéro : le premier choix
      // permute donc DEPUIS elle, puisque c'est là que les contenus étaient montrés.
      // Rien ne s'écrit ici : l'enregistrement normal de la carte emporte l'état permuté.
      function changerLangue(nouvelle) {
        var ancienne = langueArticle;
        if (ORDRE_LANGUES.indexOf(nouvelle) === -1 || nouvelle === ancienne) {
          marquer(carte, slug);
          return;
        }
        // Relire l'écran d'abord — une frappe en cours ne doit pas se perdre — puis
        // échanger les deux langues dans ce modèle.
        var valeurs = { title: {}, subtitle: {}, resume: {} };
        for (var champ of zoneTextes.querySelectorAll('input')) {
          valeurs[champ.dataset.cle][champ.dataset.langue] = champ.value;
        }
        for (var zone of zoneTextes.querySelectorAll('textarea')) {
          valeurs[zone.dataset.cle][zone.dataset.langue] = zone.value;
        }
        for (var c = 0; c < champsMultilingues.length; c++) {
          var map = valeurs[champsMultilingues[c]];
          var t = map[ancienne] || '';
          map[ancienne] = map[nouvelle] || '';
          map[nouvelle] = t;
        }
        editeurMots.permuter(ancienne, nouvelle);
        langueArticle = nouvelle;
        // Les cases se recalculent : l'ancienne langue devient « manquante », cochée si
        // elle porte (encore) des contenus ; une case cochée à la main le reste.
        var anciennes = cochees;
        cochees = {};
        var brut = editeurMots.collecterBrut();
        languesManquantes().forEach(function (lg) {
          var contenu = champsMultilingues.some(function (cle) { return !!valeurs[cle][lg]; }) ||
            (brut[lg] || []).some(function (m) { return String(m).trim() !== ''; });
          cochees[lg] = contenu || !!anciennes[lg];
        });
        poserClasses();
        rendreChampsTextes(valeurs);
        rendreCases();
        editeurMots.reconstruire(colonnes());
        appeler('carteChangee', carte);
        marquer(carte, slug);
      }
      return carte;
    }

    // Refaite en entier après chaque édition : les rangs se décalent quand on retire
    // quelqu'un, et une fiche affichée n'a pas d'état à préserver.
    function rendreAuteurs(carte, slug, focus) {
      var zone = carte.querySelector('.auteurs');
      if (!zone) { return; }
      zone.textContent = '';
      var liste = auteursParCarte.get(carte) || [];
      var apercus = apercusParCarte.get(carte) || [];
      var fiches = [];
      for (var i = 0; i < liste.length; i++) {
        fiches.push({
          slug: slug, index: i, auteur: liste[i], apercu: apercus[i] || null,
          carte: carte, apercus: apercus,
          surRetirer: function (fiche) {
            var courante = auteursParCarte.get(fiche.carte) || [];
            courante.splice(fiche.index, 1);
            (apercusParCarte.get(fiche.carte) || []).splice(fiche.index, 1);
            auteursParCarte.set(fiche.carte, courante);
            rendreAuteurs(fiche.carte, fiche.slug);
            marquer(fiche.carte, fiche.slug);
          }
        });
        ctlAuteurs.apercu(zone, fiches[fiches.length - 1]);
      }
      var ajouter = document.createElement('button');
      ajouter.type = 'button';
      ajouter.className = 'szh-bouton';
      ajouter.textContent = TXT.ajouterAuteur;
      // Une personne s'ajoute par la modale : une fiche vide dans la liste n'apprendrait
      // rien et se retrouverait enregistrée telle quelle.
      ajouter.addEventListener('click', function () {
        ctlAuteurs.ouvrir({
          slug: slug, index: (auteursParCarte.get(carte) || []).length, auteur: {},
          carte: carte, apercus: apercusParCarte.get(carte) || []
        });
      });
      zone.appendChild(ajouter);
      // Le focus revient sur la fiche qu'on vient d'éditer : le bouton d'où l'on venait a
      // été détaché par ce re-rendu, et le clavier repartirait du haut de la page.
      if (focus !== undefined && fiches[focus] && fiches[focus].boutonEditer) {
        try { fiches[focus].boutonEditer.focus(); } catch (e) { /* pas focalisable */ }
      }
    }

    function collecter(carte) {
      var resultat = { type: '', lang: '', licence: '', doi: '', title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };
      var sel = carte.querySelector('select[data-cle=type]');
      if (sel) { resultat.type = sel.value; }
      var selLangue = carte.querySelector('select[data-cle=lang]');
      if (selLangue) { resultat.lang = selLangue.value; }
      var selLicence = carte.querySelector('select[data-cle=licence]');
      if (selLicence) { resultat.licence = selLicence.value; }
      // Le doi n'est collecté qu'en mode manuel : case décochée, la fiche repart sans
      // doi, et le calculé — que le champ affiche — ne s'écrit jamais nulle part.
      var cocheDoi = carte.querySelector('[data-cle="doi-manuel"]');
      var doiManuel = !!(cocheDoi && cocheDoi.checked);
      var entreeDoi = carte.querySelector('input[data-cle=doi]');
      if (entreeDoi) { resultat.doi = doiManuel ? entreeDoi.value : ''; }
      // Les champs multilingues, dans les TROIS langues : les colonnes non révélées
      // partent aussi, rien ne se perd à l'enregistrement.
      for (var i of carte.querySelectorAll('.champs-textes input')) {
        var cle = i.dataset.cle;
        if (cle === 'title' || cle === 'subtitle' || cle === 'resume') { resultat[cle][i.dataset.langue] = i.value; }
      }
      for (var z of carte.querySelectorAll('.champs-textes textarea')) {
        var cleZone = z.dataset.cle;
        if (cleZone === 'title' || cleZone === 'subtitle' || cleZone === 'resume') { resultat[cleZone][z.dataset.langue] = z.value; }
      }
      resultat.author = (auteursParCarte.get(carte) || []).slice();
      var editeurMots = motsClesParCarte.get(carte);
      if (editeurMots) { resultat.keywords = editeurMots.collecter(); }
      return resultat;
    }

    function modifiees() {
      var envoi = {};
      for (var carte of conteneur.querySelectorAll('.carte')) {
        if (modifies.has(carte.dataset.slug)) { envoi[carte.dataset.slug] = collecter(carte); }
      }
      return envoi;
    }

    function oublier() {
      modifies.clear();
      surChangement();
      for (var carte of conteneur.querySelectorAll('.carte.modifie')) { carte.classList.remove('modifie'); }
    }

    // Traite les réponses de l'hôte qui concernent l'enregistrement et la photo. Rend
    // true si le message a été consommé, pour que la page n'ait pas à les connaître.
    function message(msg) {
      if (msg.type === 'valeurs') {
        SZH.poserAccent(msg.accent);
        rendre(msg.articles || [], msg.types || [], msg.langue || 'fr',
          msg.licences || null, msg.licenceDefaut || null);
        surValeurs(msg);
        return true;
      }
      if (msg.type === 'enregistre') {
        if (minuteurEnr) { minuteurEnr.confirme(); }
        // Les marques ne sont retirées qu'après un enregistrement automatique : après un
        // enregistrement demandé, l'hôte renvoie les valeurs et la page se re-rend.
        if (msg.auto) { oublier(); }
        if (etat) { etat.textContent = TXT.enregistre.split('{0}').join(msg.n); }
        return true;
      }
      if (msg.type === 'erreur') {
        if (minuteurEnr) { minuteurEnr.confirme(); }
        if (etat) { etat.textContent = '⚠ ' + msg.message; }
        return true;
      }
      if (msg.type === 'doi-manuel-reponse') {
        reponseDoi(msg);
        return true;
      }
      // Le vocabulaire edudoc.ch pour l'autocomplétion des mots-clés : gardé même reçu
      // avant que la première carte n'existe, comme auteurs-connus pour ctlAuteurs.
      if (msg.type === 'mots-cles-connus') {
        poserMotsClesConnus(msg.motsCles);
        return true;
      }
      return ctlAuteurs.message(msg);
    }

    // Un fichier lâché à côté d'une zone de dépôt ne doit pas remplacer la page.
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) { e.preventDefault(); });

    // Branche l'enregistrement : le bouton, le minuteur d'enregistrement automatique et
    // le message envoyé à l'hôte. La page rend la main au minuteur en appelant
    // `confirme()` à la réponse de l'hôte, qu'elle soit un succès ou une erreur.
    var minuteurEnr = null;
    function enregistrement(bouton) {
      function envoyer(auto) {
        if (modifies.size === 0) {
          if (!auto && etat) { etat.textContent = TXT.rien; }
          return;
        }
        api.postMessage({ type: 'enregistrer', auto: !!auto, articles: modifiees() });
      }
      minuteurEnr = SZH.autoEnregistrement({
        estModifie: function () { return modifies.size > 0; },
        enregistrer: envoyer
      });
      if (bouton) {
        bouton.addEventListener('click', function () { minuteurEnr.annuler(); envoyer(false); });
      }
      return minuteurEnr;
    }

    // Traductions : cachées au départ, mots-clés exceptés — une fiche se remplit d'abord
    // dans la langue du numéro, et trois langues déroulées d'emblée triplaient la hauteur
    // de chaque carte. L'état vit sur le conteneur, et non carte par carte : il survit
    // ainsi au re-rendu, qui recrée toutes les cartes. Le libellé du bouton dit l'état.
    var traductionsVisibles = !!opts.traductionsVisibles;
    function traductions(bouton) {
      var poser = function () {
        conteneur.classList.toggle('sans-trad', !traductionsVisibles);
        if (!bouton) { return; }
        bouton.textContent = traductionsVisibles ? TXT.tradMasquer : TXT.tradAfficher;
        bouton.setAttribute('aria-pressed', traductionsVisibles ? 'true' : 'false');
      };
      if (bouton) {
        bouton.addEventListener('click', function () {
          traductionsVisibles = !traductionsVisibles;
          poser();
        });
      }
      poser();
    }

    return {
      rendre: rendre,
      traductions: traductions,
      collecter: collecter,
      modifiees: modifiees,
      oublier: oublier,
      marquer: marquer,
      message: message,
      enregistrement: enregistrement,

      estModifie: function () { return modifies.size > 0; }
    };
  }

  SZH.cartesArticles = cartesArticles;
})();
