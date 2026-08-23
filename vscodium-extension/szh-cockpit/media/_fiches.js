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
  // La carte (type, titres, sous-titres, résumés, auteurs, DOI, mots-clés) et la modale
  // photo, partagées par « Métadonnées des articles » et « Vérification de l'import ».
  // Les deux pages ne diffèrent que par des décorations : la seconde pose un badge sur
  // chaque intitulé et un compteur de champs vides. D'où `decor`, dont tous les crochets
  // sont facultatifs :
  //
  //   titre(h2, slug)                 remplit l'en-tête de la carte
  //   champ(label, champId)           décore l'intitulé d'un champ
  //   motsCles(label, langues, noms)  décore l'intitulé du bloc de mots-clés
  //   finCarte(carte, article)        carte construite et insérée
  //   carteChangee(carte)             la colonne italienne vient d'être basculée
  //   marque(carte, slug)             une carte vient d'être marquée modifiée
  //
  // `surChangement()` est appelé quand l'ensemble des cartes modifiées change, y compris
  // au re-rendu qui le vide. `surValeurs(msg)` l'est après le rendu d'un message
  // « valeurs », pour ce que la page ajoute autour des cartes. `traductionsVisibles`
  // ouvre les langues dès le départ, ce dont la vérification d'import a besoin : ses
  // badges « à compléter » vivent dans les intitulés, traductions comprises.
  //
  // Protocole avec l'hôte :
  //   hôte -> webview : valeurs { articles, types, langue, accent }
  // La partie photo est celle de _auteurs.js, à qui les messages sont passés.
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
    // Les auteur·e·s d'une carte ne vivent plus dans le DOM : la fiche affichée est
    // statique, et c'est ce modèle que la modale édite et que collecter() relit.
    var auteursParCarte = new WeakMap();
    var apercusParCarte = new WeakMap();
    var TYPES = [];
    var LANGUE_DEFAUT = 'fr';

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

    // `traduction` marque les champs d'une autre langue que celle du numéro : ils sont
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

    // ---- Construction des cartes ----

    function rendre(articles, types, langueDefaut) {
      if (types) { TYPES = types; }
      if (langueDefaut) { LANGUE_DEFAUT = langueDefaut; }
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
      var avecIt = ['title', 'subtitle', 'resume'].some(function (c) { return v[c] && v[c].it; }) ||
        (v.keywords && v.keywords.it && v.keywords.it.length > 0);
      if (avecIt) { carte.classList.add('avec-it'); }

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

      // La langue par défaut du numéro vient en premier, les autres en dessous. L'italien
      // est toujours construit, et révélé par le CSS.
      var ordre = ['fr', 'de', 'it'];
      var defaut = ordre.indexOf(LANGUE_DEFAUT) !== -1 ? LANGUE_DEFAUT : 'fr';
      var langues = [defaut].concat(ordre.filter(function (l) { return l !== defaut; }));
      var noms = { fr: 'FR', de: 'DE', it: 'IT' };
      var textes = [['title', TXT.titreChamp, false], ['subtitle', TXT.sousTitre, false],
        ['resume', TXT.resume, true]];
      for (var c = 0; c < textes.length; c++) {
        for (var g = 0; g < langues.length; g++) {
          var lg = langues[g];
          champTexte(carte, carte, slug, textes[c][0], lg,
            textes[c][1].split('{0}').join(noms[lg]), (v[textes[c][0]] || {})[lg], textes[c][2], g > 0);
        }
      }

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

      champTexte(carte, carte, slug, 'doi', null, 'DOI', v.doi);

      // Mots-clés : on ajoute et on retire une rangée entière, jamais un mot dans une
      // seule langue, la position seule appariant « diagnostic » et « Diagnose ».
      var lMots = document.createElement('label');
      lMots.textContent = TXT.motsClesTitre || '';
      appeler('motsCles', lMots, langues, noms);
      carte.appendChild(lMots);
      var colonnes = function (avec) {
        return langues.filter(function (l) { return l !== 'it' || avec; })
          .map(function (l) { return { code: l, libelle: noms[l] }; });
      };
      // SZH.motsCles : la grille vit dans _commun.js, un autre IIFE. L'appeler sans le
      // préfixe levait une ReferenceError au premier bloc de mots-clés — donc à chaque
      // carte, donc sur les deux formulaires, qui s'ouvraient vides sans un mot.
      var editeurMots = SZH.motsCles({
        langues: colonnes(avecIt),
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

      var caseIt = document.createElement('label');
      caseIt.className = 'case-it';
      var coche = document.createElement('input');
      coche.type = 'checkbox';
      coche.checked = avecIt;
      caseIt.appendChild(coche);
      caseIt.appendChild(document.createTextNode(TXT.italien));
      coche.addEventListener('change', function () {
        carte.classList.toggle('avec-it', coche.checked);
        // La colonne italienne apparaît ou disparaît ; le fragment garde ses valeurs, qui
        // vivent dans son modèle et non dans le DOM.
        editeurMots.reconstruire(colonnes(coche.checked));
        appeler('carteChangee', carte);
      });
      carte.appendChild(caseIt);
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
      var resultat = { type: '', doi: '', title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };
      var sel = carte.querySelector('select[data-cle=type]');
      if (sel) { resultat.type = sel.value; }
      for (var i of carte.querySelectorAll(':scope > input, :scope > textarea')) {
        var cle = i.dataset.cle;
        var langue = i.dataset.langue;
        if (cle === 'doi') { resultat.doi = i.value; }
        else if (cle === 'title' || cle === 'subtitle' || cle === 'resume') { resultat[cle][langue] = i.value; }
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
        rendre(msg.articles || [], msg.types || [], msg.langue || 'fr');
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
