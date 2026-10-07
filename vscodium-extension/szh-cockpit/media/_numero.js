// Formulaire des métadonnées du numéro, avec la couverture. Partagé par la page
// « Métadonnées du numéro » (metadata-issue) et par la vue « Articles » (articles) : un
// champ ajouté à la table CHAMPS apparaît aux deux endroits. Le formulaire du livre
// (metadata-book) utilise le même moteur avec la table CHAMPS_LIVRE.
//
//   SZH.formulaireNumero(opts)  construit le formulaire dans opts.conteneur et le pilote
//   SZH.formulaireLivre(opts)   idem pour buch.yaml
//
// Tout le formulaire est construit ici en DOM ; le HTML des pages ne porte aucun champ. Les
// libellés arrivent de l'hôte dans opts.txt.libelles, indexés par leur clé i18n.
//
// Protocole avec l'hôte :
//   webview -> hôte : enregistrer { auto, modifies } ;
//                     couverture-deposer { nomFichier, donneesBase64 } ;
//                     ouvrir { cible } (livre : « quatrieme », ouvre couverture/quatrieme.md)
//   hôte -> webview : valeurs { valeurs, couverture, dos, focus } ;
//                     enregistre ; erreur { message } ;
//                     couverture { nom, description, apercu, inchangee }
// Pour le livre : `dos` est le dos calculé, en lecture seule ({nb_pages, dos_mm,
// grammage_couverture, source} ou null) ; l'illustration de couverture passe par les
// messages « couverture » (l'hôte demande confirmation avant de remplacer). Les listes de
// personnes (auteurs, editeurs) voyagent en tableaux dans valeurs et enregistrer.modifies,
// et s'affichent avec les cartes d'auteur·e des articles (_auteurs.js).
// `focus` nomme une clé de CHAMPS/CHAMPS_LIVRE à amener à l'écran (voir focaliser()).

(function () {
  'use strict';

  // ---- La table des champs ----
  //
  // La seule description du formulaire. `cle` est la clé d'ausgabe.yaml, `libelle` la clé
  // i18n de son intitulé, `genre` la façon de le saisir.
  var CHAMPS = [
    { cle: 'title', genre: 'texte', libelle: 'meta.title' },
    // Affiché, non saisi : le jeton `revue:` est écrit à la création du numéro
    // (windows/new-revue.ps1), et l'ISSN, la langue par défaut, le volume, la couleur
    // annuelle et le lanceur qui liste le numéro en dérivent. Le changer ici déplacerait le
    // numéro d'une revue à l'autre sans que le reste suive.
    { cle: 'revue', genre: 'lecture', libelle: 'meta.revue',
      options: [
        { valeur: 'zeitschrift', libelle: 'meta.revue.zeitschrift' },
        { valeur: 'revue', libelle: 'meta.revue.revue' }
      ] },
    { cle: 'volume', genre: 'texte', libelle: 'meta.volume' },
    { cle: 'numero', genre: 'texte', libelle: 'meta.numero' },
    { cle: 'date', genre: 'date', libelle: 'meta.date' },
    { cle: 'lang', genre: 'select', libelle: 'meta.langue',
      options: [
        { valeur: '', libelle: 'meta.langue.aucune' },
        { valeur: 'fr', libelle: 'meta.langue.fr' },
        { valeur: 'de', libelle: 'meta.langue.de' },
        { valeur: 'en', libelle: 'meta.langue.en' },
        { valeur: 'it', libelle: 'meta.langue.it' }
      ] },
    { cle: 'couleur', genre: 'couleurs', libelle: 'meta.couleur' },
    { cle: 'entete-condensee', genre: 'case', libelle: 'meta.entete.condensee' }
  ];

  // La même table pour le formulaire « Métadonnées du livre » (metadata-book.*, voir
  // SZH.formulaireLivre) : `cle` est une clé de buch.yaml, ou « parent.sous-clé » pour les
  // blocs `impression:` (papier, couverture, colle, dos imposé, fond perdu, traits de
  // coupe, profil CMJN) et `couverture:` (fond). analyserAusgabe/serialiserAusgabe
  // (lib/yaml.js) lisent et réécrivent ce niveau d'imbrication.
  var CHAMPS_LIVRE = [
    // `aide` : une ligne sous le champ. `lignes` : champ de plusieurs lignes qui grandit ; dans
    // un titre, Entrée force un retour à la ligne (écrit « // » par l'hôte, lignesVersTitre).
    { cle: 'titre', genre: 'texte', libelle: 'meta.livre.titre', aide: 'meta.livre.brAide', lignes: true },
    { cle: 'sous-titre', genre: 'texte', libelle: 'meta.livre.soustitre', aide: 'meta.livre.brAide', lignes: true },
    { cle: 'ouvrage', genre: 'radio', libelle: 'meta.livre.ouvrage',
      options: [
        { valeur: 'monographie', libelle: 'meta.livre.ouvrage.monographie' },
        { valeur: 'collectif', libelle: 'meta.livre.ouvrage.collectif' }
      ] },
    // Responsables de l'ouvrage : des listes de personnes, avec les cartes des articles.
    { cle: 'auteurs', genre: 'personnes', libelle: 'meta.livre.auteurs' },
    { cle: 'editeurs', genre: 'personnes', libelle: 'meta.livre.editeurs' },
    // `mention` : le filigrane est le défaut de la langue du livre (majMention).
    { cle: 'mention-editeurs', genre: 'texte', libelle: 'meta.livre.mention', mention: true },
    { cle: 'lang', genre: 'select', libelle: 'meta.livre.langue',
      options: [
        { valeur: 'fr', libelle: 'meta.langue.fr' },
        { valeur: 'de', libelle: 'meta.langue.de' },
        { valeur: 'it', libelle: 'meta.langue.it' },
        { valeur: 'en', libelle: 'meta.langue.en' }
      ] },
    { cle: 'maquette', genre: 'select', libelle: 'meta.livre.maquette',
      options: [
        { valeur: 'normal', libelle: 'meta.livre.maquette.normal' },
        { valeur: 'falc', libelle: 'meta.livre.maquette.falc' }
      ] },
    { cle: 'format', genre: 'select', libelle: 'meta.livre.format',
      options: [
        { valeur: 'standard', libelle: 'meta.livre.format.standard' },
        { valeur: 'a4', libelle: 'meta.livre.format.a4' }
      ] },
    { cle: 'collection', genre: 'texte', libelle: 'meta.livre.collection' },
    { cle: 'tome', genre: 'texte', libelle: 'meta.livre.tome' },
    { cle: 'annee', genre: 'nombre', libelle: 'meta.livre.annee' },
    { cle: 'isbn-print', genre: 'texte', libelle: 'meta.livre.isbnPrint' },
    { cle: 'isbn-ebook', genre: 'texte', libelle: 'meta.livre.isbnEbook' },
    { cle: 'doi', genre: 'texte', libelle: 'meta.livre.doi' },
    { cle: 'licence', genre: 'select', libelle: 'meta.livre.licence', optionsDe: 'licences' },
    // Deux couleurs : celle de l'écran (PDF numérique, EPUB, web), libre et choisie
    // accessible ; celle de l'imprimé, une clé de pipeline/styles/couleurs-reference.json.
    { cle: 'couleur', genre: 'hex', libelle: 'meta.livre.couleur' },
    { cle: 'couleur-impression', genre: 'couleursRef', libelle: 'meta.livre.couleurImpression' },
    // ---- Fond de couverture : un seul bloc, à fusionner avec le fond paramétrable ----
    { cle: 'couverture.fond', genre: 'couleursRef', libelle: 'meta.livre.fond', defaut: 'poireau' },
    { cle: 'couverture.fond-teinte', genre: 'nombre', libelle: 'meta.livre.fondTeinte',
      min: 1, max: 100, defaut: '9' },
    // Décalage de l'illustration dans sa zone : des millimètres, décimales et négatifs permis.
    { cle: 'couverture.illustration-x-mm', genre: 'nombre', libelle: 'meta.livre.illusX',
      pas: 'any', defaut: '0', aide: 'meta.livre.illusAide' },
    { cle: 'couverture.illustration-y-mm', genre: 'nombre', libelle: 'meta.livre.illusY',
      pas: 'any', defaut: '0', aide: 'meta.livre.illusAide' },
    { cle: 'couverture.modele', genre: 'select', libelle: 'livre.couverture.modele',
      options: [
        { valeur: '', libelle: 'livre.couverture.modele.defaut' },
        { valeur: 'falc', libelle: 'livre.couverture.modele.falc' },
        { valeur: 'classique', libelle: 'livre.couverture.modele.classique' },
        { valeur: 'recherche', libelle: 'livre.couverture.modele.recherche' },
        { valeur: 'prospectrum', libelle: 'livre.couverture.modele.prospectrum' }
      ] },
    { cle: 'couverture.illustration-plein', genre: 'case', libelle: 'livre.couverture.illustrationPlein',
      aide: 'livre.couverture.illustrationPlein.aide' },
    { cle: 'couverture.titre-2', genre: 'texte', libelle: 'livre.couverture.titre2',
      aide: 'livre.couverture.voisinAide', lignes: true },
    { cle: 'couverture.sous-titre-2', genre: 'texte', libelle: 'livre.couverture.sousTitre2',
      aide: 'livre.couverture.voisinAide', lignes: true },
    // ---- fin du bloc « fond de couverture » ----
    { cle: 'impression.grammage', genre: 'nombre', libelle: 'meta.livre.grammage' },
    { cle: 'impression.main', genre: 'nombre', libelle: 'meta.livre.main' },
    { cle: 'impression.couverture-volume', genre: 'nombre', libelle: 'meta.livre.couvVolume' },
    { cle: 'impression.couverture-grammage', genre: 'nombre', libelle: 'meta.livre.couvGrammage' },
    { cle: 'impression.colle-mm', genre: 'nombre', libelle: 'meta.livre.colleMm' },
    { cle: 'impression.dos-mm', genre: 'nombre', libelle: 'meta.livre.dosMm' },
    { cle: 'impression.fond-perdu-mm', genre: 'nombre', libelle: 'meta.livre.fondPerduMm' },
    { cle: 'impression.traits-de-coupe', genre: 'case', libelle: 'meta.livre.traitsDeCoupe' },
    { cle: 'impression.profil-cmjn', genre: 'texte', libelle: 'meta.livre.profilCmjn' },
    // Blocs sans clé de buch.yaml (ni lus ni écrits par remplir/envoyer) : le dos calculé,
    // lu de out/ ; l'illustration de couverture ; le bouton de la 4e de couverture.
    { bloc: 'dos', libelle: 'meta.livre.dos' },
    { bloc: 'illustration' },
    { bloc: 'quatrieme', libelle: 'meta.livre.quatrieme', bouton: 'meta.livre.quatrieme.ouvrir' }
  ];

  // Comme normaliserRevue() (lib/yaml.js) et derive_revue() côté Lua : accepte le jeton et
  // l'ancien nom complet, et teste « zeitschrift » avant « revue ».
  function normaliserRevue(v) {
    var s = String(v === undefined || v === null ? '' : v).toLowerCase();
    if (s.indexOf('zeitschrift') !== -1) { return 'zeitschrift'; }
    if (s.indexOf('revue') !== -1) { return 'revue'; }
    return '';
  }

  // Moteur commun aux deux formulaires : `champsTable` est CHAMPS (numéro) ou CHAMPS_LIVRE
  // (livre), voir les deux enveloppes en bas du fichier.
  function construireFormulaire(opts, champsTable) {
    var conteneur = opts.conteneur;
    var api = opts.api;
    var TXT = opts.txt || {};
    var L = TXT.libelles || {};
    var etat = opts.etat || null;
    var modifies = {};                 // cle -> true : seuls les champs touchés partent
    var ctl = {};                      // cle -> élément ou accessoire de saisie
    var couleurs = TXT.couleurs || [];
    var couleurChoisie = '';
    var revueChoisie = '';
    var indiceDate = null;
    var zoneCouverture = null;
    var apercuEnGrand = null;          // modale d'agrandissement, construite au besoin
    var personnes = {};                // cle -> liste des personnes affichées (livre)
    var ctlAuteurs = null;             // SZH.auteurs : fiche et modale, celles des articles
    var dosTexte = null;               // le dos calculé, lecture seule (livre)
    var couleursRef = [];              // la référence de l'imprimé : [{ cle, nom, rgb }]
    // Formats et poids acceptés : ceux de lib/articles.js, envoyés par l'hôte, qui les
    // revérifie.
    var EXTENSIONS = TXT.couvertureExtensions || [];
    var MAXI = Number(TXT.couvertureMax) || 0;

    function lib(cle) { return L[cle] === undefined ? '' : L[cle]; }
    function toucher(cle) {
      modifies[cle] = true;
      if (etat) { etat.textContent = ''; }
    }
    function aDesModifs() {
      for (var c in modifies) { if (modifies[c]) { return true; } }
      return false;
    }

    // ---- Construction ----

    var poser = SZH.poser;

    function champTexte(champ, type) {
      var bloc = poser(conteneur, 'div', 'szh-champ');
      poser(bloc, 'label', null, lib(champ.libelle)).setAttribute('for', 'num-' + champ.cle);
      var i = document.createElement(champ.lignes ? 'textarea' : 'input');
      if (champ.lignes) {
        i.rows = 1;
        i.style.resize = 'none';
        i.style.overflow = 'hidden';
        i._ajuster = function () {
          i.style.height = 'auto';
          if (i.scrollHeight) { i.style.height = i.scrollHeight + 'px'; }
        };
        i.addEventListener('input', i._ajuster);
      } else { i.type = type; }
      i.id = 'num-' + champ.cle;
      i.dataset.cle = champ.cle;
      i.addEventListener('input', function () { toucher(champ.cle); });
      if (champ.min !== undefined) { i.min = String(champ.min); }
      if (champ.max !== undefined) { i.max = String(champ.max); }
      if (champ.defaut !== undefined) { i.placeholder = champ.defaut; }
      if (champ.pas !== undefined) { i.step = champ.pas; }
      bloc.appendChild(i);
      if (champ.aide) { poser(bloc, 'p', 'champ-aide', lib(champ.aide)); }
      ctl[champ.cle] = i;
      if (champ.cle === 'date') {
        // Une date que le champ ne sait pas afficher (« 2026 » seul) : on affiche ce que le
        // fichier porte, pour qu'elle ne soit pas écrasée en silence.
        indiceDate = poser(bloc, 'p', 'szh-notif szh-notif--attention szh-notif--discret');
        indiceDate.hidden = true;
      }
    }

    // `champ.options` est la liste ordinaire : des clés i18n, résolues par lib(). Un champ
    // qui pointe `champ.optionsDe` (la licence du livre) prend la liste déjà traduite envoyée
    // par l'hôte dans TXT[optionsDe], comme TXT.couleurs ; la liste des licences vit dans
    // lib/yaml.js (LICENCES_ARTICLE).
    function champSelect(champ) {
      var bloc = poser(conteneur, 'div', 'szh-champ');
      poser(bloc, 'label', null, lib(champ.libelle)).setAttribute('for', 'num-' + champ.cle);
      var s = document.createElement('select');
      s.id = 'num-' + champ.cle;
      s.dataset.cle = champ.cle;
      var dynamique = !!champ.optionsDe;
      var options = dynamique ? (TXT[champ.optionsDe] || []) : champ.options;
      for (var i = 0; i < options.length; i++) {
        var o = document.createElement('option');
        o.value = options[i].valeur;
        o.textContent = dynamique ? (options[i].libelle || '') : lib(options[i].libelle);
        s.appendChild(o);
      }
      s.addEventListener('input', function () { toucher(champ.cle); });
      bloc.appendChild(s);
      if (champ.aide) { poser(bloc, 'p', 'champ-aide', lib(champ.aide)); }
      ctl[champ.cle] = s;
    }

    // Couleur d'accent du livre, libre (buch.yaml en porte une par ouvrage), alors que la
    // couleur annuelle du numéro se choisit dans une palette fermée. Le <input type=color>
    // natif rend toujours un hex à six chiffres : aucune valeur hors format n'en sort.
    function champHexCouleur(champ) {
      var bloc = poser(conteneur, 'div', 'szh-champ');
      poser(bloc, 'label', null, lib(champ.libelle)).setAttribute('for', 'num-' + champ.cle);
      var ligne = poser(bloc, 'div', 'hexcouleur');
      var i = document.createElement('input');
      i.type = 'color';
      i.id = 'num-' + champ.cle;
      i.dataset.cle = champ.cle;
      var texte = poser(ligne, 'span', 'hexcouleur-valeur');
      function majTexte() { texte.textContent = i.value.toUpperCase(); }
      i.addEventListener('input', function () { majTexte(); toucher(champ.cle); });
      ligne.insertBefore(i, texte);
      majTexte();
      ctl[champ.cle] = i;
    }

    // La revue est un choix fermé : le jeton zeitschrift ou revue est écrit dans
    // ausgabe.yaml, l'ISSN et la langue par défaut en dérivent.
    function champRadio(champ) {
      var bloc = poser(conteneur, 'div', 'szh-champ');
      var titre = poser(bloc, 'label', null, lib(champ.libelle));
      titre.setAttribute('id', 'num-' + champ.cle + '-label');
      var groupe = poser(bloc, 'div', 'radios');
      groupe.dataset.cle = champ.cle;
      groupe.setAttribute('role', 'radiogroup');
      groupe.setAttribute('aria-labelledby', 'num-' + champ.cle + '-label');
      var radios = [];
      for (var i = 0; i < champ.options.length; i++) {
        (function (option) {
          var l = poser(groupe, 'label', 'radio');
          var r = document.createElement('input');
          r.type = 'radio';
          r.name = 'num-' + champ.cle;
          r.value = option.valeur;
          r.addEventListener('change', function () {
            if (!r.checked) { return; }
            revueChoisie = r.value;
            toucher(champ.cle);
          });
          l.appendChild(r);
          poser(l, 'span', null, lib(option.libelle));
          radios.push(r);
        }(champ.options[i]));
      }
      ctl[champ.cle] = { radios: radios };
    }

    // Version en lecture seule de champRadio : même intitulé, un texte à la place du groupe
    // de boutons (voir `revue` dans CHAMPS). Le texte est posé par remplir().
    function champLecture(champ) {
      var bloc = poser(conteneur, 'div', 'szh-champ');
      poser(bloc, 'label', null, lib(champ.libelle));
      var texte = poser(bloc, 'p', 'champ-lecture');
      texte.dataset.cle = champ.cle;
      ctl[champ.cle] = { texte: texte };
    }

    function champCase(champ) {
      var l = poser(conteneur, 'label', 'case');
      var c = document.createElement('input');
      c.type = 'checkbox';
      c.dataset.cle = champ.cle;
      c.addEventListener('change', function () { toucher(champ.cle); });
      l.appendChild(c);
      poser(l, 'span', null, lib(champ.libelle));
      if (champ.aide) { poser(conteneur, 'p', 'champ-aide', lib(champ.aide)); }
      ctl[champ.cle] = c;
    }

    // ---- Livre : listes de personnes, couleurs de référence, dos, 4e de couverture ----

    // Auteur·e·s et éditeur·rice·s : la fiche et la modale d'édition des articles
    // (_auteurs.js), sans la photo. Les personnes restent dans `personnes[cle]` jusqu'à
    // l'enregistrement ; ajouter, éditer ou retirer relance l'enregistrement automatique.
    function modifierPersonnes(cle) {
      rendrePersonnes(cle);
      toucher(cle);
      autoEnr.programmer();
    }

    function rendrePersonnes(cle) {
      var zone = (ctl[cle] || {}).zone;
      if (!zone) { return; }
      zone.textContent = '';
      var liste = personnes[cle] || [];
      for (var i = 0; i < liste.length; i++) {
        ctlAuteurs.apercu(zone, {
          slug: cle, cle: cle, index: i, auteur: liste[i], apercu: null,
          surRetirer: function (c) {
            personnes[c.cle].splice(c.index, 1);
            modifierPersonnes(c.cle);
          }
        });
      }
    }

    function champPersonnes(champ) {
      if (!ctlAuteurs) {
        ctlAuteurs = SZH.auteurs({
          api: api, txt: TXT, sansPhoto: true,
          persister: function (c, auteur, fini) {
            var liste = personnes[c.cle];
            if (c.index >= liste.length) { liste.push(auteur); } else { liste[c.index] = auteur; }
            modifierPersonnes(c.cle);
            fini(null);
          }
        });
      }
      var bloc = poser(conteneur, 'div', 'szh-champ personnes');
      poser(bloc, 'label', null, lib(champ.libelle));
      var zone = poser(bloc, 'div', 'personnes-liste');
      zone.dataset.cle = champ.cle;
      var ajouter = document.createElement('button');
      ajouter.type = 'button';
      ajouter.className = 'szh-bouton';
      ajouter.textContent = lib('fiches.auteur.ajouter');
      ajouter.addEventListener('click', function () {
        ctlAuteurs.ouvrir({
          slug: champ.cle, cle: champ.cle, index: (personnes[champ.cle] || []).length,
          auteur: {}, apercu: null
        });
      });
      bloc.appendChild(ajouter);
      personnes[champ.cle] = [];
      ctl[champ.cle] = { zone: zone };
    }

    // Une couleur de la table de référence de l'imprimé, par pastille (liste envoyée par
    // l'hôte depuis pipeline/styles/couleurs-reference.json). `defaut` est la valeur
    // appliquée quand le fichier n'en dit rien : elle s'allume sans rien écrire.
    function champCouleursRef(champ) {
      var bloc = poser(conteneur, 'div', 'szh-champ');
      poser(bloc, 'label', null, lib(champ.libelle));
      var zone = poser(bloc, 'div', 'pastilles');
      zone.dataset.cle = champ.cle;
      ctl[champ.cle] = { zone: zone, choisie: '', defaut: champ.defaut || '' };
      rendreCouleursRef(champ);
    }

    // Une pastille par couleur de la référence ; la liste arrive avec les valeurs
    // (couleursImpression) et se redessine si elle change.
    function rendreCouleursRef(champ) {
      var etatRef = ctl[champ.cle];
      etatRef.zone.textContent = '';
      var items = couleursRef;
      var zone = etatRef.zone;
      for (var i = 0; i < items.length; i++) {
        (function (c) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'pastille';
          b.dataset.valeur = c.cle;
          b.setAttribute('aria-pressed', 'false');
          var puce = document.createElement('span');
          puce.className = 'puce';
          puce.style.background = c.rgb;
          b.appendChild(puce);
          b.appendChild(document.createTextNode(c.nom));
          b.addEventListener('click', function () {
            etatRef.choisie = c.cle;
            majCouleurRef(champ.cle);
            toucher(champ.cle);
            autoEnr.programmer();
          });
          zone.appendChild(b);
        }(items[i]));
      }
      majCouleurRef(champ.cle);
    }

    function majCouleurRef(cle) {
      var etatRef = ctl[cle];
      var allumee = etatRef.choisie || etatRef.defaut;
      var boutons = etatRef.zone.querySelectorAll('.pastille');
      for (var i = 0; i < boutons.length; i++) {
        boutons[i].setAttribute('aria-pressed', boutons[i].dataset.valeur === allumee ? 'true' : 'false');
      }
    }

    // Le filigrane de la mention des éditeurs : le mot par défaut de la langue du livre.
    function majMention() {
      var champ = ctl['mention-editeurs'];
      if (!champ) { return; }
      var langue = ctl.lang ? ctl.lang.value : 'fr';
      champ.placeholder = lib('meta.livre.mention.defaut.' + langue) || lib('meta.livre.mention.defaut.fr');
    }

    // Le dos calculé par la compilation de la couverture, en lecture seule. Un fichier
    // absent ou illisible (dos null) affiche quoi faire.
    function blocDos(champ) {
      var bloc = poser(conteneur, 'div', 'szh-champ');
      poser(bloc, 'label', null, lib(champ.libelle));
      dosTexte = poser(bloc, 'p', 'champ-lecture');
      dosTexte.dataset.cle = 'dos';
      poserDos(null);
    }

    function poserDos(dos) {
      if (!dosTexte) { return; }
      if (!dos) { dosTexte.textContent = lib('meta.livre.dos.absent'); return; }
      var virgule = function (n) { return String(Math.round(Number(n) * 10) / 10).replace('.', ','); };
      dosTexte.textContent = lib('meta.livre.dos.valeur')
        .split('{0}').join(virgule(dos.dos_mm))
        .split('{1}').join(String(Math.round(Number(dos.nb_pages))))
        .split('{2}').join(String(Math.round(Number(dos.grammage_couverture))));
    }

    // La 4e de couverture s'écrit dans l'éditeur : le bouton demande à l'hôte de l'ouvrir
    // (et de la créer vide s'il manque).
    function blocBouton(champ) {
      var bloc = poser(conteneur, 'div', 'szh-champ');
      poser(bloc, 'label', null, lib(champ.libelle));
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'szh-bouton';
      b.dataset.cle = champ.bloc;
      b.textContent = lib(champ.bouton);
      b.addEventListener('click', function () {
        api.postMessage({ type: SZH.MSG.OUVRIR, cible: champ.bloc });
      });
      bloc.appendChild(b);
    }

    // Couleur annuelle : une pastille par teinte, la puce montre la couleur. Un bouton
    // n'émet ni « input » ni « change » : l'enregistrement automatique est relancé à la main.
    function champCouleurs(champ) {
      var bloc = poser(conteneur, 'div', 'szh-champ');
      poser(bloc, 'label', null, lib(champ.libelle));
      var zone = poser(bloc, 'div', 'pastilles');
      zone.dataset.cle = champ.cle;
      ctl[champ.cle] = { zone: zone };
      rendreCouleurs();
    }

    function majPastilles() {
      var zone = (ctl.couleur || {}).zone;
      if (!zone) { return; }
      var boutons = zone.querySelectorAll('.pastille');
      for (var i = 0; i < boutons.length; i++) {
        boutons[i].setAttribute('aria-pressed',
          boutons[i].dataset.hex === couleurChoisie ? 'true' : 'false');
      }
    }

    function rendreCouleurs() {
      var zone = (ctl.couleur || {}).zone;
      if (!zone) { return; }
      zone.textContent = '';
      // Pas de pastille « (aucune) » : quand `couleur:` est vide ou absente, aucune pastille
      // n'est allumée (majPastilles, aria-pressed).
      var items = couleurs;
      for (var i = 0; i < items.length; i++) {
        (function (c) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'pastille';
          b.dataset.hex = c.hex;
          b.setAttribute('aria-pressed', 'false');
          if (c.hex) {
            var puce = document.createElement('span');
            puce.className = 'puce';
            puce.style.background = c.hex;
            b.appendChild(puce);
          }
          b.appendChild(document.createTextNode(c.nom));
          b.addEventListener('click', function () {
            couleurChoisie = c.hex;
            majPastilles();
            toucher('couleur');
            autoEnr.programmer();
          });
          zone.appendChild(b);
        }(items[i]));
      }
      majPastilles();
    }

    // ---- Couverture ----
    //
    // couverture.jpg à la racine du numéro, le fichier que cherche l'export OJS : on le
    // dépose, on le voit, on le remplace ici.
    function blocCouverture() {
      var bloc = poser(conteneur, 'div', 'szh-champ couverture');
      poser(bloc, 'label', null, TXT.couverture || '');
      zoneCouverture = { visuel: poser(bloc, 'div', 'visuel'), etat: null, nom: poser(bloc, 'p', 'couverture-nom') };
      var d = SZH.construireDepot({
        parent: bloc, icone: 'camera', libelle: TXT.couvertureDeposer || '',
        extensions: EXTENSIONS, texteChoisir: TXT.couvertureChoisir || '',
        surFichier: function (f) { envoyerCouverture(f); }
      });
      zoneCouverture.etat = d.etat;
      poserCouverture(null);
    }

    // Le format et le poids sont vérifiés ici pour répondre tout de suite, et par l'hôte, qui
    // ne se fie pas à la webview. Lecture et découpage base64 : SZH.lireBase64 (_commun.js).
    function envoyerCouverture(f) {
      SZH.lireBase64(f, {
        extensions: EXTENSIONS, maxi: MAXI,
        msgFormat: '⚠ ' + (TXT.couvertureFormat || ''), msgPoids: '⚠ ' + (TXT.couverturePoids || ''),
        surLecture: function () { zoneCouverture.etat.textContent = '…'; },
        surErreur: function (message) { zoneCouverture.etat.textContent = message; },
        surDonnees: function (fichier, base64) {
          api.postMessage({ type: SZH.MSG.COUVERTURE_DEPOSER, nomFichier: fichier.name, donneesBase64: base64 });
        }
      });
    }

    // L'aperçu est un bouton : un clic l'agrandit. Sans couverture, la place le dit.
    function poserCouverture(info) {
      if (!zoneCouverture) { return; }
      zoneCouverture.visuel.textContent = '';
      if (!info || !info.nom) {
        zoneCouverture.visuel.appendChild(SZH.notif('attention', TXT.couvertureAbsente || ''));
        zoneCouverture.nom.textContent = '';
        return;
      }
      zoneCouverture.nom.textContent = info.nom + (info.description ? ' – ' + info.description : '');
      if (!info.apercu) {
        poser(zoneCouverture.visuel, 'p', 'absent', TXT.couvertureApercuAbsent || '');
        return;
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'apercu';
      b.title = TXT.couvertureAgrandir || '';
      b.setAttribute('aria-label', TXT.couvertureAgrandir || '');
      var img = document.createElement('img');
      img.src = info.apercu;
      img.alt = info.nom;
      b.appendChild(img);
      b.addEventListener('click', function () { agrandir(info.apercu, info.nom); });
      zoneCouverture.visuel.appendChild(b);
    }

    // L'aperçu de la carte est petit : on peut l'agrandir sans quitter le formulaire. Le
    // voile, Échap et le retour du focus viennent de SZH.modale.
    function agrandir(apercu, nom) {
      if (!apercuEnGrand) {
        var vue = {};
        apercuEnGrand = SZH.modale({
          construire: function (boite) {
            vue.img = document.createElement('img');
            boite.appendChild(vue.img);
            var pied = poser(boite, 'div', 'szh-modale-pied');
            vue.nom = poser(pied, 'span', 'modale-nom');
            poser(pied, 'span', 'szh-pousse');
            vue.fermer = document.createElement('button');
            vue.fermer.type = 'button';
            vue.fermer.className = 'szh-bouton szh-bouton--principal';
            vue.fermer.textContent = TXT.couvertureFermer || '';
            vue.fermer.addEventListener('click', function () { apercuEnGrand.fermer(); });
            pied.appendChild(vue.fermer);
          },
          surFermeture: function () { vue.img.removeAttribute('src'); },
          focus: function () { return vue.fermer; }
        });
        apercuEnGrand.vue = vue;
      }
      apercuEnGrand.vue.img.src = apercu;
      apercuEnGrand.vue.img.alt = nom || '';
      apercuEnGrand.vue.nom.textContent = nom || '';
      apercuEnGrand.ouvrir();
    }

    // ---- Remplissage et collecte ----

    function remplir(valeurs) {
      var v = valeurs || {};
      for (var i = 0; i < champsTable.length; i++) {
        var champ = champsTable[i];
        if (!champ.cle) { continue; }
        if (champ.genre === 'personnes') {
          personnes[champ.cle] = [];
          var recues = Array.isArray(v[champ.cle]) ? v[champ.cle] : [];
          for (var q = 0; q < recues.length; q++) { personnes[champ.cle].push(recues[q]); }
          rendrePersonnes(champ.cle);
          continue;
        }
        var brut = v[champ.cle] === undefined ? '' : String(v[champ.cle]);
        if (champ.genre === 'couleursRef') {
          ctl[champ.cle].choisie = brut;
          majCouleurRef(champ.cle);
          continue;
        }
        if (champ.genre === 'radio') {
          revueChoisie = normaliserRevue(brut);
          var radios = (ctl[champ.cle] || {}).radios || [];
          for (var r = 0; r < radios.length; r++) { radios[r].checked = (radios[r].value === revueChoisie); }
          continue;
        }
        if (champ.genre === 'lecture') {
          // Même jeton que le radio, que d'autres parties du formulaire lisent dans
          // revueChoisie. Une valeur vide ou hors liste affiche un tiret cadratin, pour ne pas
          // ressembler à un défaut d'affichage.
          revueChoisie = normaliserRevue(brut);
          var optionLue = null;
          for (var o = 0; o < (champ.options || []).length; o++) {
            if (champ.options[o].valeur === revueChoisie) { optionLue = champ.options[o]; break; }
          }
          var texteLu = (ctl[champ.cle] || {}).texte;
          if (texteLu) { texteLu.textContent = optionLue ? lib(optionLue.libelle) : '–'; }
          continue;
        }
        if (champ.genre === 'couleurs') {
          couleurChoisie = brut;
          majPastilles();
          continue;
        }
        if (champ.genre === 'case') {
          // La valeur arrive déjà ramenée à « true » ou « false » par estVraiYaml
          // (lib/yaml.js).
          ctl[champ.cle].checked = (brut === 'true');
          continue;
        }
        if (champ.genre === 'hex') {
          // Une valeur absente ou malformée devient #000000, affiché aussi dans le texte à
          // côté, au lieu de laisser chaque moteur décider.
          var hexBrut = /^#[0-9A-Fa-f]{6}$/.test(brut) ? brut : '#000000';
          ctl[champ.cle].value = hexBrut;
          var spanHex = ctl[champ.cle].nextElementSibling;
          if (spanHex) { spanHex.textContent = hexBrut.toUpperCase(); }
          continue;
        }
        var e = ctl[champ.cle];
        e.value = brut;
        if (e._ajuster) { e._ajuster(); }
        if (champ.cle === 'date' && indiceDate) {
          if (brut !== '' && e.value !== brut) {
            indiceDate.textContent = (TXT.indiceDate || '').split('{0}').join(brut);
            indiceDate.hidden = false;
          } else { indiceDate.hidden = true; }
        }
        // Une langue hors liste n'est pas une option du <select> : on n'affiche pas une
        // valeur qui n'est pas celle du fichier.
        if (champ.genre === 'select' && e.value !== brut) { e.value = ''; }
      }
      majMention();
      modifies = {};
      if (etat) { etat.textContent = ''; }
    }

    // Seuls les champs touchés partent : ausgabe.yaml garde le reste, commentaires compris,
    // et deux personnes qui éditent deux clés différentes ne s'écrasent pas.
    function envoyer(auto) {
      if (!aDesModifs()) {
        if (!auto && etat) { etat.textContent = TXT.rien || ''; }
        return;
      }
      var envoi = {};
      for (var i = 0; i < champsTable.length; i++) {
        var champ = champsTable[i];
        if (!champ.cle || !modifies[champ.cle]) { continue; }
        // « revue » (genre lecture) n'est jamais marqué modifié, champLecture ne posant aucun
        // gestionnaire. Le test ci-dessous garantit en plus que le jeton ne repart jamais
        // vers l'hôte.
        if (champ.genre === 'lecture') { continue; }
        // Le seul champ radio est « ouvrage » (CHAMPS_LIVRE).
        if (champ.genre === 'radio') { envoi[champ.cle] = revueChoisie; }
        else if (champ.genre === 'couleurs') { envoi[champ.cle] = couleurChoisie; }
        else if (champ.genre === 'couleursRef') { envoi[champ.cle] = ctl[champ.cle].choisie; }
        else if (champ.genre === 'personnes') { envoi[champ.cle] = (personnes[champ.cle] || []).slice(); }
        else if (champ.genre === 'case') { envoi[champ.cle] = ctl[champ.cle].checked ? 'true' : 'false'; }
        else { envoi[champ.cle] = ctl[champ.cle].value; }
      }
      api.postMessage({ type: SZH.MSG.ENREGISTRER, auto: !!auto, modifies: envoi });
    }

    // Enregistrement automatique : trois secondes après la dernière frappe, au changement
    // d'un choix, et quand le panneau perd le focus.
    var autoEnr = SZH.autoEnregistrement({
      estModifie: aDesModifs,
      enregistrer: envoyer
    });

    // Amène un champ à l'écran et y pose le curseur. `cle` est une clé de champsTable
    // (CHAMPS/CHAMPS_LIVRE) ; une clé inconnue ou vide est ignorée, la table ne les
    // connaissant pas toutes (« pièce », « chapitre »).
    function focaliser(cle) {
      var c = ctl[String(cle || '')];
      if (!c) { return; }
      // ctl[cle] est l'élément lui-même pour texte, select, case et hex ; pour radio,
      // couleurs et lecture, c'est un accessoire qui ne reçoit pas le curseur : on l'amène
      // seulement à l'écran.
      var el = (c.nodeType === 1) ? c : (c.radios ? c.radios[0] : (c.zone || c.texte || null));
      if (!el) { return; }
      try { el.scrollIntoView({ block: 'center' }); } catch (e) { el.scrollIntoView(); }
      if (typeof el.focus === 'function') { el.focus(); }
    }

    // Les messages que ce fragment traite ; rend vrai quand il les a traités.
    function message(msg) {
      if (msg.type === SZH.MSG.VALEURS) {
        if (msg.couleursImpression) {
          couleursRef = msg.couleursImpression;
          for (var r = 0; r < champsTable.length; r++) {
            if (champsTable[r].genre === 'couleursRef') { rendreCouleursRef(champsTable[r]); }
          }
        }
        remplir(msg.valeurs);
        // La couverture n'est redessinée que si le message la porte : son aperçu pèse
        // plusieurs mégaoctets en base64, et un nouveau rendu de la vue ne le renvoie pas.
        if (zoneCouverture && msg.couverture !== undefined) { poserCouverture(msg.couverture); }
        if (msg.dos !== undefined) { poserDos(msg.dos); }
        if (msg.focus) { focaliser(msg.focus); }
        return true;
      }
      if (msg.type === SZH.MSG.ENREGISTRE) {
        autoEnr.confirme();
        modifies = {};
        if (etat) { etat.textContent = TXT.enregistre || ''; }
        return true;
      }
      if (msg.type === SZH.MSG.ERREUR) {
        autoEnr.confirme();
        if (etat) { etat.textContent = '⚠ ' + (msg.message || ''); }
        return true;
      }
      if (msg.type === SZH.MSG.COUVERTURE) {
        if (zoneCouverture) {
          zoneCouverture.etat.textContent = (msg.nom && !msg.inchangee) ? (TXT.couvertureEnregistree || '') : '';
          poserCouverture(msg);
        }
        return true;
      }
      // La liste des auteur·e·s connus, pour l'autocomplétion de la modale (livre).
      if (ctlAuteurs && ctlAuteurs.message(msg)) { return true; }
      return false;
    }

    // Le bouton « Enregistrer » reste, pour voir « ✓ » tout de suite.
    function enregistrement(bouton) {
      if (!bouton) { return; }
      bouton.addEventListener('click', function (e) {
        if (e && e.preventDefault) { e.preventDefault(); }
        autoEnr.annuler();
        envoyer(false);
      });
    }

    // ---- Montage ----
    for (var i = 0; i < champsTable.length; i++) {
      var champ = champsTable[i];
      if (champ.genre === 'texte') { champTexte(champ, 'text'); }
      else if (champ.genre === 'date') { champTexte(champ, 'date'); }
      else if (champ.genre === 'nombre') { champTexte(champ, 'number'); }
      else if (champ.genre === 'select') { champSelect(champ); }
      else if (champ.genre === 'radio') { champRadio(champ); }
      else if (champ.genre === 'lecture') { champLecture(champ); }
      else if (champ.genre === 'case') { champCase(champ); }
      else if (champ.genre === 'couleurs') { champCouleurs(champ); }
      else if (champ.genre === 'hex') { champHexCouleur(champ); }
      else if (champ.genre === 'personnes') { champPersonnes(champ); }
      else if (champ.genre === 'couleursRef') { champCouleursRef(champ); }
      else if (champ.bloc === 'dos') { blocDos(champ); }
      else if (champ.bloc === 'illustration') { blocCouverture(); }
      else if (champ.bloc === 'quatrieme') { blocBouton(champ); }
    }
    if (opts.couverture) { blocCouverture(); }
    if (ctl.lang && ctl['mention-editeurs']) { ctl.lang.addEventListener('input', majMention); }
    majMention();

    return {
      remplir: remplir, message: message, enregistrement: enregistrement,
      estModifie: aDesModifs, champs: champsTable, focaliser: focaliser
    };
  }

  // Deux enveloppes sur le même moteur : celle du numéro (metadata-issue.js, articles.js),
  // celle du livre (metadata-book.js).
  function formulaireNumero(opts) { return construireFormulaire(opts, CHAMPS); }
  function formulaireLivre(opts) { return construireFormulaire(opts, CHAMPS_LIVRE); }

  SZH.formulaireNumero = formulaireNumero;
  SZH.formulaireLivre = formulaireLivre;
})();
