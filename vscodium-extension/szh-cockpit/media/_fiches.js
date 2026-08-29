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
  //                     doi-manuel-reponse { slug, sens, ok }
  //   webview -> hôte : doi-manuel-confirmer { slug, sens }
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
