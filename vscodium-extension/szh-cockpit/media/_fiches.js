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
  //   hôte -> webview : valeurs { articles, types, licences, licenceDefaut, langue, accent,
  //                     formeDoi: { motif, exemple }, verifTrad, filtre, focus } ; formeDoi
  //                     vaut la forme des DOI de la revue du numéro — absente sur la page de
  //                     vérification d'import, qui ne l'envoie pas (voir champDoi plus bas) ;
  //                     verifTrad dit si le vérificateur de traduction est actif (voir la
  //                     pastille plus bas) ; focus nomme un [data-cle] à amener à l'écran —
  //                     boutons de constat (revue F03), n'a d'effet que si filtre vaut une
  //                     seule carte (voir focaliserChamp) ;
  //                     doi-manuel-reponse { slug, sens, ok } ;
  //                     mots-cles-connus { motsCles: [{ de, fr }] } (autocomplétion, voir
  //                     attacherAutocompletionMotsCles plus bas)
  //   webview -> hôte : doi-manuel-confirmer { slug, sens } ;
  //                     suggererTraduction { slug, champ, langue, valeur }
  // La partie photo est celle de _auteurs.js, à qui les messages sont passés.

  // ---- Autocomplétion des mots-clés : le vocabulaire edudoc.ch (lib/mots-cles-edudoc.js) --
  //
  // Reçu de l'hôte en paires bilingues { de, fr } (message mots-cles-connus). La grille de
  // mots-clés (SZH.motsCles, _commun.js) apparie déjà « diagnostic » et « Diagnose » par
  // position — une rangée est un mot-clé, une colonne par langue — et c'est cette même
  // règle qui gouverne l'autocomplétion : on propose dans la langue du champ où l'on
  // tape (son data-langue), jamais dans une autre. Choisir une suggestion pose en plus,
  // dans la case de l'autre langue sur la même rangée, l'équivalent que le thésaurus
  // bilingue connaît déjà — et ÉCRASE ce qui s'y trouvait : la paire edudoc.ch (de, fr) est
  // justement ce qui relie « Sonderpädagogik » à « pédagogie spécialisée », et la grille du
  // formulaire relie ses colonnes de la même façon, par position. Choisir dans une liste
  // fermée est un geste délibéré qui vaut pour la rangée entière, pas seulement pour la
  // case où l'on tapait. Seule exception : si le thésaurus ne connaît pas d'équivalent dans
  // l'autre langue (paire incomplète, champ `manque` côté hôte), la case de l'autre langue
  // n'est pas touchée — écraser une saisie par du vide serait une perte pure.
  // Ceci diverge délibérément de la règle des champs enrichis des auteur·e·s
  // (media/_auteurs.js), où une correction déjà tapée n'est jamais effacée : là, le champ
  // complète une fiche que le rédacteur a pu corriger à la main, et cette correction doit
  // survivre. Ici, il n'y a rien à corriger à la main — un mot-clé edudoc est une paire
  // indivisible du thésaurus, pas une fiche éditable au champ par champ.
  //
  // Aucun vocabulaire italien : lib/mots-cles-edudoc.js ne moissonne que DE/FR (les deux
  // revues n'y publient pas en italien). Le champ `it` de la grille ne déclenche donc
  // jamais de suggestion, et ne reçoit jamais d'équivalent complété — plutôt que de
  // proposer du français à qui tape en italien.
  //
  // Les paires incomplètes (« manque » côté hôte) ne sont simplement jamais indexées dans
  // la langue qui leur manque : pDe/pFr valent alors null, et chercherMotsCles les saute.
  //
  // Posée en délégation sur le conteneur de la grille (editeurMots.element), qui n'est
  // jamais remplacé : SZH.motsCles reconstruit tout son DOM interne à chaque ajout, retrait
  // ou permutation de rangée (voir son commentaire « Reconstruit le DOM depuis le modèle,
  // sans jamais le relire »), et un écouteur posé sur un <input> précis serait perdu à la
  // reconstruction suivante.
  //
  // ---- Le thésaurus comme chemin par défaut, et son second rideau (Robin, sept. 2026) ----
  //
  // Les suggestions s'ouvrent dès le PREMIER caractère (et non plus deux) : le thésaurus
  // est le chemin par défaut de la saisie, il doit se présenter tôt. Quand aucun descripteur
  // ne correspond à ce qui est tapé, la boîte ne montre plus une liste vide mais UNE seule
  // entrée, séparée par un filet : « Ajouter « … » hors thésaurus ». C'est le geste délibéré
  // qui permet malgré tout un mot-clé hors vocabulaire — Robin y tient autant qu'au thésaurus
  // lui-même. La valeur tapée, elle, n'est JAMAIS gatée : ni cette entrée ni rien ici ne
  // touche au champ tant qu'on ne clique pas dessus (ou qu'on ne l'arme pas au clavier).
  //
  // Toute case non vide dont la valeur n'est pas un descripteur porte, en plus, une pastille
  // discrète (.mc-hors-thesaurus) : « ce mot-clé ne partira pas à l'export ». Ce marqueur
  // n'est JAMAIS écrit dans la fiche — ni dans le modèle de la grille, ni a fortiori dans le
  // .meta.yaml — il se recalcule à CHAQUE affichage (voir appliquerMarqueurs et le crochet
  // opts.surRendu de SZH.motsCles) : un terme qu'edudoc.ch adoptera plus tard cesse ainsi
  // d'être signalé tout seul, sans la moindre migration. Confirmer « ajouter hors thésaurus »
  // pour une case éteint sa pastille, mais seulement pour la SESSION (le temps que ce
  // panneau reste ouvert) : rien de cette confirmation n'est persisté non plus, c'est voulu.
  // Une case vide n'est jamais marquée (elle porte déjà le placeholder « à traduire »), et
  // l'italien — sans aucun vocabulaire edudoc.ch, voir plus haut — n'a ni suggestion ni
  // marqueur : plutôt que de signaler comme fautif tout ce qui s'écrit en italien.
  //
  // LE POINT QUI COMPTE : la pastille promet ce que l'export fera. Si sa règle de
  // reconnaissance divergeait de celle de lib/mots-cles-edudoc.js (indexerThesaurus,
  // chercherDescripteur, apparierDescripteurs), elle mentirait — pire que pas de pastille du
  // tout. La webview n'a pas de require() et ne peut donc pas charger ce module Node tel
  // quel : indexerThesaurusMc/chercherDescripteurMc/pliDescripteurMc, plus bas, le
  // réimplémentent À L'IDENTIQUE (mêmes deux passes, exactes puis dé-qualifiées ; même
  // normalisation des apostrophes courbes/obliques). plierMc (SZH.plier) plie déjà casse,
  // accents et espaces exactement comme plierNom, dont plierDescripteur part (même
  // algorithme des deux côtés) ; seule la normalisation des apostrophes manquait à plierMc,
  // d'où un pliage dédié plutôt qu'une retouche de plierMc, qui toucherait l'autocomplétion
  // des mots-clés et celle des auteur·e·s sans qu'aucune des deux n'en ait besoin.
  // test/js/mots-cles-grille.test.js compare les deux moteurs sur un corpus de cas coriaces.

  // Casse, accents, positions et séparateurs de mot : le même moteur que _auteurs.js pour
  // les noms d'auteur·e·s, partagé depuis _commun.js — les noms Mc restent, les corps
  // viennent de SZH.* (voir son commentaire pour les deux divergences tranchées).
  var plierMc = SZH.plier;
  var plierAvecIndexMc = SZH.plierAvecIndex;
  var debutsDeMotMc = SZH.debutsDeMot;
  var chercherDebutMc = SZH.chercherDebut;
  var poserAvecGrasMc = SZH.poserAvecGras;

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

  // Les entrées qui correspondent à la saisie, pour un code de langue donné ('fr' ou 'de' —
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

  // ---- Reconnaissance edudoc.ch, à l'identique de lib/mots-cles-edudoc.js ----
  //
  // Voir le commentaire de tête du fichier (« LE POINT QUI COMPTE ») : ces quatre fonctions
  // réimplémentent, terme à terme, plierDescripteur/indexerThesaurus/chercherDescripteur de
  // lib/mots-cles-edudoc.js, que la webview ne peut pas charger (pas de require()).
  var RE_QUALIFICATIF_FINAL_MC = /\s*\([^()]*\)\s*$/;   // un seul groupe, en fin de chaîne

  // « Inklusion (SZH) » -> « Inklusion » ; un texte sans parenthèse finale ressort inchangé.
  function sansQualificatifFinalMc(texte) {
    return String(texte === undefined || texte === null ? '' : texte).replace(RE_QUALIFICATIF_FINAL_MC, '');
  }

  // plierMc (=SZH.plier) plie déjà casse, accents et espaces comme plierNom, dont part
  // plierDescripteur (même algorithme des deux côtés) ; il ne manque que la normalisation
  // des trois apostrophes courbes/obliques vers l'apostrophe droite, ajoutée ici seule.
  function pliDescripteurMc(texte) {
    return plierMc(String(texte === undefined || texte === null ? '' : texte).replace(/[’‘ʼ]/g, "'"));
  }

  // Deux passes, comme indexerThesaurus : toutes les clés EXACTES d'abord, puis seulement
  // les clés DÉ-QUALIFIÉES, qui ne remplacent jamais une clé exacte déjà posée. `connus` est
  // le tableau que construireIndexMotsCles a déjà bâti pour l'autocomplétion — mêmes paires
  // {de, fr}, même ordre (celui du cache, envoyé tel quel par « mots-cles-connus ») : les
  // collisions se résolvent donc pareil des deux côtés.
  function indexerThesaurusMc(connus) {
    var index = {};
    function poserSiAbsente(cle, entree) {
      if (cle !== '' && !Object.prototype.hasOwnProperty.call(index, cle)) { index[cle] = entree; }
    }
    var i;
    for (i = 0; i < connus.length; i++) {
      poserSiAbsente(pliDescripteurMc(connus[i].de), connus[i]);
      poserSiAbsente(pliDescripteurMc(connus[i].fr), connus[i]);
    }
    for (i = 0; i < connus.length; i++) {
      poserSiAbsente(pliDescripteurMc(sansQualificatifFinalMc(connus[i].de)), connus[i]);
      poserSiAbsente(pliDescripteurMc(sansQualificatifFinalMc(connus[i].fr)), connus[i]);
    }
    return index;
  }

  // Exact d'abord, dé-qualifié ensuite — même ordre que chercherDescripteur.
  function chercherDescripteurMc(terme, index) {
    var s = String(terme === undefined || terme === null ? '' : terme).trim();
    if (s === '') { return null; }
    var exact = pliDescripteurMc(s);
    if (exact !== '' && Object.prototype.hasOwnProperty.call(index, exact)) { return index[exact]; }
    var dequalifie = pliDescripteurMc(sansQualificatifFinalMc(s));
    if (dequalifie !== '' && Object.prototype.hasOwnProperty.call(index, dequalifie)) { return index[dequalifie]; }
    return null;
  }

  // ---- Compteur de caractères du résumé : le seuil de bascule en page 2 ----
  //
  // La maquette imprime toujours les deux résumés d'un article et ses mots-clés sur la
  // première page ; au-delà d'un certain nombre de caractères, un résumé bascule en page
  // 2. Une mesure par compilation réelle de 58 articles d'essai a établi que le
  // basculement est par palier selon le nombre de mots-clés — de la même langue que le
  // résumé, puisque c'est ce qui s'imprime ensemble sur cette page-là : 3 à 5 mots-clés
  // tiennent sur une ligne (bascule vers ~830 caractères), 6 à 10 en occupent deux
  // (bascule vers ~730). Passer de 5 à 6 mots-clés coûte donc une centaine de caractères
  // de marge.
  //
  // La recommandation affichée reste prudemment en deçà de cette bascule réelle — 750
  // jusqu'à 5 mots-clés, 700 dès le sixième — et n'empêche jamais l'enregistrement : un
  // compteur informe, il ne bloque pas. `SEUIL_MOTS_CLES_PALIER` est la seule marche de
  // cet escalier, et la seule façon dont ce calcul peut se tromper en silence.
  var SEUIL_RESUME_PALIER_1 = 750;    // jusqu'à 5 mots-clés
  var SEUIL_RESUME_PALIER_2 = 700;    // dès le 6e mot-clé
  var SEUIL_MOTS_CLES_PALIER = 6;
  function seuilResume(nMotsCles) {
    return nMotsCles >= SEUIL_MOTS_CLES_PALIER ? SEUIL_RESUME_PALIER_2 : SEUIL_RESUME_PALIER_1;
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
    // Course pret/valeurs (SZH.jetonDejaTraite, _commun.js) : un jeton par formulaire.
    var etatJeton = { jeton: null };
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
    // La forme des DOI de la revue du numéro : { motif, exemple }, envoyée une fois par
    // l'hôte (message valeurs), pas par carte — voir champDoi() plus bas. Absente sur la
    // page de vérification d'import, qui ne l'envoie pas : reste null, et la note de forme
    // ne s'affiche jamais là.
    var FORME_DOI_ACTUELLE = null;
    // Livre ou revue/Zeitschrift (message valeurs, msg.estLivre) : décide de la case
    // « hors sommaire » d'une carte — jamais construite pour un article.
    var ESTLIVRE = false;
    // ---- Le vérificateur de traduction ----
    //
    // Un mode, posé par l'hôte dans le message « valeurs » (réglage du poste, voir
    // lib/archivage.js#lireVerifTraduction). Actif, chaque champ traduisible — titre,
    // sous-titre, résumé, mots-clés, chacun par langue — reçoit à côté de son intitulé une
    // pastille qui ouvre le formulaire de suggestion. Rien d'autre ne change : la carte
    // s'édite et s'enregistre exactement comme avant, et une suggestion ne modifie aucun
    // texte. Un panneau déjà ouvert quand le réglage change ne le voit qu'à sa réouverture,
    // les cartes n'étant reconstruites qu'au prochain message « valeurs ».
    var VERIF_TRAD = false;
    // Le vocabulaire edudoc.ch (message mots-cles-connus), partagé par toutes les cartes
    // de la page — une seule liste, comme TYPES et LICENCES.
    var motsClesConnus = [];
    // L'index de RECONNAISSANCE (pastille « hors thésaurus »), distinct de motsClesConnus
    // ci-dessus qui sert la recherche par préfixe de l'autocomplétion : deux besoins, deux
    // structures — voir le commentaire de tête du fichier.
    var indexThesaurusMc = null;
    // Les grilles de mots-clés actuellement affichées (une par carte) : le vocabulaire peut
    // arriver APRÈS que les cartes existent déjà (l'hôte envoie « valeurs » avant « mots-
    // cles-connus », voir envoyerValeurs/envoyerMotsClesConnus, lib/metadonnees-hote.js) —
    // sans cette liste, les pastilles construites avant l'arrivée du thésaurus resteraient
    // fausses jusqu'au prochain ajout ou retrait de rangée. Vidée à chaque rendre() complet
    // (rendre() plus bas, pas celui de SZH.motsCles), qui recrée toutes les cartes.
    var reappliquerTousLesMarqueurs = [];
    function poserMotsClesConnus(liste) {
      motsClesConnus = construireIndexMotsCles(liste);
      indexThesaurusMc = indexerThesaurusMc(motsClesConnus);
      for (var i = 0; i < reappliquerTousLesMarqueurs.length; i++) { reappliquerTousLesMarqueurs[i](); }
    }

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

    // La pastille du vérificateur, posée dans l'intitulé et non dans le champ : elle ne
    // doit ni rétrécir la zone de saisie ni s'intercaler dans la tabulation entre
    // l'intitulé et son champ. `lireValeur` est appelée AU CLIC, jamais avant : ce qui part
    // à l'hôte est ce que la personne a sous les yeux à ce moment-là, frappe en cours
    // comprise.
    function pastilleTraduction(parent, slug, champ, langue, lireValeur) {
      if (!VERIF_TRAD || !langue) { return null; }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'szh-sugg-trad';
      b.title = TXT.suggPastille || '';
      b.setAttribute('aria-label', (TXT.suggPastille || '') + ' – ' + champ + ' ' + langue.toUpperCase());
      // Le code de langue en capitales, et non ICONES.traduction : ce dessin à trois tracés
      // est fait pour un bouton de barre, il tombe en bouillie à la taille d'un intitulé. Deux
      // capitales survivent à toute taille ET disent quelle langue la pastille vise — ce que le
      // dessin ne disait qu'en infobulle, d'où deux pastilles indiscernables sur les mots-clés.
      b.textContent = langue.toUpperCase();
      b.addEventListener('click', function () {
        api.postMessage({
          type: SZH.MSG.SUGGERER_TRADUCTION, slug: slug, champ: champ, langue: langue,
          valeur: String(lireValeur() || '')
        });
      });
      parent.appendChild(b);
      return b;
    }

    // `traduction` marque les champs d'une autre langue que celle de l'article : ils sont
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
      // Les quatre champs traduisibles de la fiche sont title, subtitle, resume et keywords
      // (lib/traduction.js) ; les trois premiers passent par ici, les mots-clés ont leur
      // propre pastille plus bas. La pastille suit l'intitulé, donc son affichage.
      pastilleTraduction(l, slug, cle, langue, function () { return i.value; });
      i.addEventListener('input', function () { marquer(carte, slug); });
      parent.appendChild(l);
      parent.appendChild(i);
      return i;                    // le résumé y accroche son compteur de caractères
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
    //
    // Deux notes de plus, jamais bloquantes — la maison ne bloque jamais la saisie, seul
    // l'export refuse (voir le compteur de résumé plus haut, même règle) :
    //   - la FORME : FORME_DOI_ACTUELLE (motif + exemple de la revue du numéro) contre la
    //     valeur tapée, revérifiée à chaque frappe et retirée dès que la case se décoche ou
    //     que la saisie redevient bonne ;
    //   - l'UNICITÉ : deux cartes ne peuvent pas envoyer le même DOI. verifierDoublonsDoi()
    //     compare, à chaque frappe, le DOI EFFECTIF de toutes les cartes du conteneur — son
    //     manuel actif, sinon son calculé — et note celles dont le manuel coïncide avec une
    //     autre. doiParCarte garde les éléments qu'il lui faut pour cela.
    function doiEffectifCarte(carte) {
      var ctl = doiParCarte.get(carte);
      if (!ctl) { return ''; }
      if (ctl.coche.checked) { return ctl.entree.value.trim(); }
      return String(ctl.calcule || '').trim();
    }

    function verifierDoublonsDoi() {
      var parDoi = {};
      for (var c of conteneur.querySelectorAll('.carte')) {
        var d = doiEffectifCarte(c);
        if (d === '') { continue; }
        if (!parDoi[d]) { parDoi[d] = []; }
        parDoi[d].push(c.dataset.slug);
      }
      for (var c2 of conteneur.querySelectorAll('.carte')) {
        var ctl = doiParCarte.get(c2);
        if (!ctl) { continue; }
        var autre = '';
        if (ctl.coche.checked) {
          var val = ctl.entree.value.trim();
          if (val !== '') {
            var pairs = (parDoi[val] || []).filter(function (s) { return s !== c2.dataset.slug; });
            if (pairs.length > 0) { autre = pairs[0]; }
          }
        }
        ctl.noteDouble.hidden = autre === '';
        if (autre !== '') { ctl.noteDouble.textContent = (TXT.doiDouble || '').split('{0}').join(autre); }
      }
    }

    function champDoi(carte, slug, article) {
      var v = article.valeurs || {};
      var calcule = String(article.doiCalcule || '').trim();
      var manuel = String(v.doi || '').trim() !== '';
      var l = document.createElement('label');
      l.textContent = 'DOI';
      var i = document.createElement('input');
      i.type = 'text';
      i.dataset.cle = 'doi';
      var caseDoi = document.createElement('label');
      caseDoi.className = 'case-doi';
      var coche = document.createElement('input');
      coche.type = 'checkbox';
      coche.dataset.cle = 'doi-manuel';
      caseDoi.appendChild(coche);
      caseDoi.appendChild(document.createTextNode(TXT.doiManuel));

      var forme = (FORME_DOI_ACTUELLE && FORME_DOI_ACTUELLE.motif)
        ? { motif: new RegExp(FORME_DOI_ACTUELLE.motif), exemple: FORME_DOI_ACTUELLE.exemple }
        : null;
      var noteForme = document.createElement('p');
      noteForme.className = 'szh-notif szh-notif--attention szh-notif--discret doi-note';
      noteForme.hidden = true;
      var noteDouble = document.createElement('p');
      noteDouble.className = 'szh-notif szh-notif--attention szh-notif--discret doi-note';
      noteDouble.hidden = true;

      function majForme() {
        if (!forme || !coche.checked) { noteForme.hidden = true; return; }
        var val = i.value.trim();
        if (val === '' || forme.motif.test(val)) { noteForme.hidden = true; return; }
        noteForme.hidden = false;
        noteForme.textContent = (TXT.doiForme || '').split('{0}').join(forme.exemple);
      }

      function poser(actif, valeur) {
        coche.checked = actif;
        i.readOnly = !actif;
        i.classList.toggle('doi-verrouille', !actif);
        i.title = actif ? '' : TXT.doiVerrouTip;
        i.value = actif ? valeur : (calcule !== '' ? calcule : '–');
        majForme();
        verifierDoublonsDoi();
      }
      // Posé avant le premier poser() : verifierDoublonsDoi() parcourt toutes les cartes du
      // conteneur, celle-ci comprise, et la retrouve donc dans doiParCarte dès son premier
      // appel.
      doiParCarte.set(carte, { poser: poser, calcule: calcule, entree: i, coche: coche, noteDouble: noteDouble });
      poser(manuel, v.doi || '');
      i.addEventListener('input', function () {
        marquer(carte, slug);
        majForme();
        verifierDoublonsDoi();
      });
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
        api.postMessage({ type: SZH.MSG.DOI_MANUEL_CONFIRMER, slug: slug,
          sens: veut ? 'activer' : 'retirer' });
      });
      carte.appendChild(l);
      carte.appendChild(i);
      carte.appendChild(noteForme);
      carte.appendChild(noteDouble);
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
    function attacherAutocompletionMotsCles(editeurMots, motsClesOpts) {
      var conteneurMc = editeurMots.element;
      var boiteSugg = document.createElement('div');
      boiteSugg.className = 'szh-sugg';
      boiteSugg.hidden = true;
      boiteSugg.setAttribute('role', 'listbox');
      boiteSugg.setAttribute('aria-label', TXT.motsClesSuggestions || '');
      var suggEtat = { input: null, items: [], actif: -1 };
      var enSelection = false;               // vrai pendant qu'on écrit nous-mêmes une valeur

      // ---- La pastille « hors thésaurus » : signale sans jamais rien changer ----
      //
      // Voir le commentaire de tête du fichier pour le contrat complet. `confirmesHorsThesaurus`
      // est propre à CETTE grille (une carte) et ne survit pas à un re-rendu complet de la
      // page — exactement le sens de « la confirmation ne vaut que pour la session ».
      var confirmesHorsThesaurus = {};   // 'fr::cléPliée' -> true

      function cleConfirmation(langueCode, valeur) { return langueCode + '::' + pliDescripteurMc(valeur); }

      // Une case a besoin du marqueur si : elle porte une langue avec vocabulaire (jamais
      // l'italien), elle n'est pas vide (déjà le placeholder « à traduire »), elle n'a pas
      // été confirmée hors thésaurus pour cette session, et — même règle que
      // apparierDescripteurs à l'export — le descripteur trouvé, s'il y en a un, doit être
      // COMPLET dans les deux langues : une entrée à moitié renseignée au thésaurus ne suffit
      // pas plus ici qu'à l'export à faire partir un couple de mots-clés.
      function marqueurNecessaire(valeur, langueCode) {
        if (langueCode !== 'fr' && langueCode !== 'de') { return false; }
        var s = String(valeur === undefined || valeur === null ? '' : valeur).trim();
        if (s === '') { return false; }
        if (confirmesHorsThesaurus[cleConfirmation(langueCode, s)]) { return false; }
        var trouve = chercherDescripteurMc(s, indexThesaurusMc || {});
        return !(trouve && trouve.de !== '' && trouve.fr !== '');
      }

      // Repose tous les marqueurs de CETTE grille : les anciens sont retirés puis recréés,
      // plutôt que mis à jour un par un — rendre() (media/_commun.js) reconstruit tout le DOM
      // interne à chaque ajout, retrait ou permutation de rangée, et une grille de mots-clés
      // ne compte jamais assez de lignes pour qu'un repose complet coûte quoi que ce soit.
      function appliquerMarqueurs() {
        var anciens = conteneurMc.querySelectorAll('.mc-hors-thesaurus');
        for (var k = 0; k < anciens.length; k++) { anciens[k].remove(); }
        // Sous « .mc » et non « .mc-rangee:not(.mc-entete) » : la rangée d'en-tête ne porte
        // que des <span>, jamais d'<input> — inutile de l'exclure par ailleurs.
        var champs = conteneurMc.querySelectorAll('.mc input[data-langue]');
        for (var c = 0; c < champs.length; c++) {
          var champ = champs[c];
          if (!marqueurNecessaire(champ.value, champ.dataset.langue)) { continue; }
          var rangee = champ.closest('.mc-rangee');
          if (!rangee) { continue; }
          var marque = document.createElement('span');
          marque.className = 'mc-hors-thesaurus';
          // La langue en donnée : une rangée porte plusieurs cases, chacune sa propre
          // pastille éventuelle — sans ce marqueur, rien ne distinguerait celle de la case
          // FR de celle de la case DE, posées toutes deux comme enfants de la même rangée.
          marque.dataset.langue = champ.dataset.langue;
          marque.setAttribute('role', 'img');
          marque.setAttribute('aria-label', TXT.motsClesHorsThesaurus || '');
          marque.title = TXT.motsClesHorsThesaurus || '';
          // Positionnée comme la boîte de suggestions plus bas (offsetLeft/offsetWidth du
          // champ) : chaque colonne a une largeur différente selon les langues affichées, il
          // n'y a pas de coordonnée fixe possible.
          marque.style.left = (champ.offsetLeft + champ.offsetWidth - 10) + 'px';
          rangee.appendChild(marque);
        }
      }

      function confirmerHorsThesaurus(langueCode, valeur) {
        var s = String(valeur === undefined || valeur === null ? '' : valeur).trim();
        if (s === '') { return; }
        confirmesHorsThesaurus[cleConfirmation(langueCode, s)] = true;
        fermerSuggestions();
        appliquerMarqueurs();
      }

      // Le crochet d'après-rendu (SZH.motsCles, _commun.js) : rendre() efface et reconstruit
      // tout le DOM interne à chaque ajout/retrait de rangée, à la permutation des langues ou
      // au changement des colonnes affichées — les marqueurs doivent donc être reposés après
      // coup. `motsClesOpts` est le MÊME objet que celui passé au constructeur de
      // SZH.motsCles : le fixer ici plutôt qu'à la construction est nécessaire, le tout
      // premier rendre() ayant lieu PENDANT la construction, avant que cette fonction
      // n'existe — l'appel immédiat en fin d'attacherAutocompletionMotsCles couvre ce
      // premier rendu (et le cas d'un mot-clé hérité déjà hors thésaurus à l'ouverture).
      motsClesOpts.surRendu = appliquerMarqueurs;

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

      // Choisir une suggestion écrase toujours le champ où l'on tape, et pose aussi
      // l'équivalent du thésaurus dans la case de l'autre langue sur la même rangée — en
      // écrasant ce qui s'y trouvait, sauf si le thésaurus n'a pas d'équivalent (paire
      // incomplète) : voir le commentaire de tête du fichier pour la justification de ce
      // choix, et pourquoi il diverge de la règle des auteur·e·s.
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
        if (champAutre) {
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
        var saisieBrute = input.value.trim();
        var saisie = plierMc(input.value);
        // Dès le PREMIER caractère (et non plus deux) : le thésaurus est le chemin par
        // défaut de la saisie, il doit se présenter tôt — voir le commentaire de tête.
        if (motsClesConnus.length === 0 || saisie.length < 1) { fermerSuggestions(); return; }
        var trouves = chercherMotsCles(motsClesConnus, langueCode, saisie);
        fermerSuggestions();
        var rangee = input.closest('.mc-rangee');
        if (!rangee) { return; }
        suggEtat = { input: input, items: [], actif: -1 };
        if (trouves.length === 0) {
          // Le second rideau : aucun descripteur ne correspond. La valeur tapée n'est
          // JAMAIS touchée ici — seuls un clic ou un Entrée sur cette entrée la confirment
          // hors thésaurus (confirmerHorsThesaurus, plus haut) ; en attendant, la pastille
          // de la case le dit déjà (appliquerMarqueurs, appelée après cette fonction).
          var filet = document.createElement('div');
          filet.className = 'szh-sugg-filet';
          boiteSugg.appendChild(filet);
          var horsTh = document.createElement('button');
          horsTh.type = 'button';
          horsTh.className = 'szh-sugg-item szh-sugg-item--hors-thesaurus';
          horsTh.setAttribute('role', 'option');
          horsTh.setAttribute('aria-selected', 'false');
          horsTh.textContent = SZH.remplir(TXT, 'motsClesAjouterHorsThesaurus', [saisieBrute]);
          horsTh.addEventListener('mousedown', function (e) { e.preventDefault(); });
          horsTh.addEventListener('click', function () {
            confirmerHorsThesaurus(langueCode, input.value.trim());
          });
          boiteSugg.appendChild(horsTh);
          suggEtat.items.push({ element: horsTh, trouve: null, horsThesaurus: true });
        } else {
          for (var i = 0; i < trouves.length; i++) {
            (function (t) {
              var b = document.createElement('button');
              b.type = 'button';
              b.className = 'szh-sugg-item';
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
        }
        // Positionnée sous la case où l'on tape, pas sous la rangée entière qui couvre
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
          var item = suggEtat.actif >= 0 ? suggEtat.items[suggEtat.actif] : null;
          if (item && item.horsThesaurus) {
            e.preventDefault();
            confirmerHorsThesaurus(input.dataset.langue, input.value.trim());
          } else if (item) {
            e.preventDefault();
            choisir(item.trouve, input.dataset.langue, input);
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
        // La valeur vient de changer : le marqueur de CETTE case (et d'elle seule aurait
        // suffi, mais reposer toute la grille est aussi simple et reste bon marché) doit
        // suivre tout de suite — jamais après coup, jamais au prix d'un aller-retour vers
        // l'hôte.
        appliquerMarqueurs();
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

      // Cette grille existe désormais : le vocabulaire peut encore arriver après coup (voir
      // reappliquerTousLesMarqueurs plus haut), et cette carte doit alors suivre comme les
      // autres. L'appel immédiat couvre le rendu qui vient d'avoir lieu — un mot-clé hérité
      // déjà hors thésaurus se voit tout de suite, sans attendre une frappe.
      reappliquerTousLesMarqueurs.push(appliquerMarqueurs);
      appliquerMarqueurs();
    }

    // ---- Construction des cartes ----

    function rendre(articles, types, langueDefaut, licences, licenceDefaut, formeDoi, estLivre) {
      if (types) { TYPES = types; }
      if (langueDefaut) { LANGUE_DEFAUT = langueDefaut; }
      if (licences) { LICENCES = licences; }
      if (licenceDefaut) { LICENCE_DEFAUT = licenceDefaut; }
      FORME_DOI_ACTUELLE = formeDoi || null;
      ESTLIVRE = !!estLivre;
      ctlAuteurs.fermer();                           // re-rendu : la fiche visée disparaît
      conteneur.textContent = '';
      modifies.clear();
      // Toutes les cartes vont être recréées : les grilles de mots-clés d'avant n'existent
      // déjà plus, chacune repeuplera cette liste en s'attachant (attacherAutocompletionMotsCles).
      reappliquerTousLesMarqueurs = [];
      surChangement();
      for (var n = 0; n < articles.length; n++) {
        var carte = construireCarte(articles[n]);
        conteneur.appendChild(carte);
        appeler('finCarte', carte, articles[n]);
      }
      // Un DOI manuel hérité peut déjà coïncider avec un autre à l'ouverture du formulaire
      // (une fiche recopiée d'un article à l'autre, par exemple) : la note ne doit pas
      // attendre la première frappe pour le dire.
      verifierDoublonsDoi();
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
      // L'ordre d'affichage suit l'article : sa langue d'abord, puis la langue par défaut
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

      // Type : n'a de sens que pour un article (éditorial, documentation…), jamais pour
      // un chapitre — un livre n'en a pas de taxonomie. Absente du DOM pour ESTLIVRE, la
      // clé reste préservée telle quelle à l'enregistrement : voir nettoyerCarte()
      // (lib/metadonnees-hote.js), qui ne l'efface que si la fiche est celle d'un article.
      if (!ESTLIVRE) {
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
      }

      // Langue de l'article : elle prime au rendu sur celle du numéro. Le <select> vient
      // de SZH.choixLangue (_commun.js), une seule description pour les deux formulaires.
      // La changer permute les contenus entre l'ancienne et la nouvelle langue — voir
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
      // près, qui viennent de l'hôte. Sans objet pour un chapitre — la licence d'un livre
      // se décide pour l'ouvrage entier, pas chapitre par chapitre — donc absente pour
      // ESTLIVRE, avec la même préservation que le type ci-dessus.
      if (!ESTLIVRE) {
        var licence = SZH.choixFerme({
          cle: 'licence', libelle: TXT.licence, options: LICENCES,
          valeur: v.licence, defaut: LICENCE_DEFAUT,
          onChange: function () { marquer(carte, slug); }
        });
        appeler('champ', licence.label, 'licence');
        carte.appendChild(licence.label);
        carte.appendChild(licence.select);
      }

      // Hors sommaire : livre seulement, jamais construite pour un article — la clé
      // `sommaire:` n'existe même pas côté fiche d'article (voir lib/yaml.js). Cochée : le
      // chapitre perd numéro, pastille et marque de tranche, et les autres se renumérotent
      // — c'est pipeline/profils/livre.mk (CHAPITRES_HORS_SOMMAIRE) qui fait ce travail à
      // la compilation, cette case ne fait qu'écrire la clé.
      if (ESTLIVRE) {
        var caseSommaire = document.createElement('label');
        caseSommaire.className = 'case-sommaire';
        var cocheSommaire = document.createElement('input');
        cocheSommaire.type = 'checkbox';
        cocheSommaire.dataset.cle = 'sommaire';
        cocheSommaire.checked = !!v.horsSommaire;
        cocheSommaire.addEventListener('change', function () { marquer(carte, slug); });
        caseSommaire.appendChild(cocheSommaire);
        caseSommaire.appendChild(document.createTextNode(TXT.sommaireCase || ''));
        appeler('champ', caseSommaire, 'sommaire');
        carte.appendChild(caseSommaire);
        var aideSommaire = document.createElement('p');
        aideSommaire.className = 'case-sommaire-aide';
        aideSommaire.textContent = TXT.sommaireAide || '';
        carte.appendChild(aideSommaire);
      }

      // Les champs multilingues vivent dans leur propre zone, reconstruite au changement
      // de langue : la langue de l'article vient en premier, les autres en dessous.
      var textes = [['title', TXT.titreChamp, false], ['subtitle', TXT.sousTitre, false],
        ['resume', TXT.resume, true]];
      var zoneTextes = document.createElement('div');
      zoneTextes.className = 'champs-textes';
      carte.appendChild(zoneTextes);

      // ---- Le compteur du résumé, un par langue affichée ----
      //
      // `editeurMots` (plus bas) n'existe pas encore au tout premier rendu : le seuil
      // calculé ici avec zéro mot-clé est provisoire, et `majTousCompteursResume()` le
      // corrige dès que la grille des mots-clés existe — avant que la carte ne quitte
      // cette fonction et ne soit posée dans la page, donc sans jamais s'afficher faux.
      var compteursResume = {};        // langue -> { champ: <textarea>, el: <compteur> }
      function compterMotsClesLangue(lg) {
        if (!editeurMots) { return 0; }
        var liste = editeurMots.collecterBrut()[lg] || [];
        var n = 0;
        for (var i = 0; i < liste.length; i++) {
          if (String(liste[i] || '').trim() !== '') { n++; }
        }
        return n;
      }
      function majCompteurResume(lg) {
        var c = compteursResume[lg];
        if (!c) { return; }
        var n = c.champ.value.length;             // espaces comprises : l'unité de la mesure
        var seuil = seuilResume(compterMotsClesLangue(lg));
        c.el.textContent = (TXT.resumeCompteur || '{0} / {1}')
          .split('{0}').join(String(n)).split('{1}').join(String(seuil));
        // Progressif et discret : une seule teinte franchie avant le seuil, une autre au
        // seuil ou au-delà — jamais un blocage, l'enregistrement n'y regarde pas.
        c.el.classList.toggle('compteur-resume--proche', n >= seuil * 0.9 && n < seuil);
        c.el.classList.toggle('compteur-resume--depasse', n >= seuil);
      }
      function majTousCompteursResume() {
        for (var lg in compteursResume) {
          if (Object.prototype.hasOwnProperty.call(compteursResume, lg)) { majCompteurResume(lg); }
        }
      }
      // Capture lg par appel, comme choisir()/attacherAutocompletionMotsCles plus haut :
      // un écouteur posé dans la boucle ci-dessous verrait sinon toujours la dernière
      // langue de la boucle, jamais la sienne.
      function surSaisieResume(lg) { return function () { majCompteurResume(lg); }; }

      function rendreChampsTextes(valeurs) {
        zoneTextes.textContent = '';
        compteursResume = {};
        var langues = ordreAffichage();
        for (var c = 0; c < textes.length; c++) {
          for (var g = 0; g < langues.length; g++) {
            var lg = langues[g];
            var traduction = lg !== langueArticle;
            var champ = champTexte(carte, zoneTextes, slug, textes[c][0], lg,
              textes[c][1].split('{0}').join(noms[lg]),
              (valeurs[textes[c][0]] || {})[lg], textes[c][2], traduction);
            if (textes[c][0] !== 'resume') { continue; }
            var compteur = document.createElement('div');
            compteur.className = 'compteur-resume champ-' + lg + (traduction ? ' champ-trad' : '');
            compteur.dataset.langue = lg;
            compteur.id = 'compteur-resume-' + slug + '-' + lg;
            champ.setAttribute('aria-describedby', compteur.id);
            zoneTextes.appendChild(compteur);
            compteursResume[lg] = { champ: champ, el: compteur };
            champ.addEventListener('input', surSaisieResume(lg));
          }
        }
        majTousCompteursResume();
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

      // Le DOI (calculé ou manuel) : sans objet pour un chapitre — point 2, un livre n'a
      // pas d'export OJS et doisCalculesArticles() ne calcule plus rien pour lui, donc
      // article.doiCalcule arriverait de toute façon vide. `champDoi` inscrit ses
      // contrôles dans doiParCarte ; tous ses lecteurs (doiEffectifCarte,
      // verifierDoublonsDoi, collecter) tolèrent déjà son absence.
      if (!ESTLIVRE) { champDoi(carte, slug, article); }

      // Mots-clés edudoc/thésaurus : sans objet pour un chapitre, même raison que le type
      // et la licence ci-dessus — pas de classification par sujet pour un livre. `var
      // editeurMots` reste déclarée (hissage de `var`) pour que compterMotsClesLangue()
      // plus haut et changerLangue() plus bas, qui la lisent toutes deux, continuent de
      // fonctionner : elles savent déjà tolérer son absence (`if (!editeurMots) …`, voir
      // ci-dessus) ou sont gardées ici pour la même raison.
      var editeurMots;
      if (!ESTLIVRE) {
        // On ajoute et on retire une rangée entière, jamais un mot dans une seule langue,
        // la position seule appariant « diagnostic » et « Diagnose ».
        var lMots = document.createElement('label');
        lMots.textContent = TXT.motsClesTitre || '';
        appeler('motsCles', lMots, ordreAffichage(), noms);
        carte.appendChild(lMots);
        var colonnes = function () {
          return languesVisibles().map(function (l) { return { code: l, libelle: noms[l] }; });
        };
        // SZH.motsCles : la grille vit dans _commun.js, un autre IIFE — l'appeler sans le
        // préfixe lève une ReferenceError à chaque carte, sur les deux formulaires.
        var motsClesOpts = {
          langues: colonnes(),
          listes: v.keywords || {},
          edition: true,
          textes: {
            motCle: TXT.motsCles, ajouter: TXT.motCleAjouter,
            retirer: TXT.motCleRetirer, aTraduire: TXT.motCleATraduire
          },
          // Un mot-clé ajouté, retiré ou vidé peut faire changer de palier (voir
          // seuilResume plus haut) : les compteurs des résumés doivent le suivre en direct,
          // dans les deux sens — un cinquième mot-clé qui disparaît redonne 750.
          onChange: function () { marquer(carte, slug); majTousCompteursResume(); }
          // surRendu est posé par attacherAutocompletionMotsCles, juste en dessous : c'est
          // elle qui sait reposer la pastille « hors thésaurus » après chaque reconstruction.
        };
        editeurMots = SZH.motsCles(motsClesOpts);
        motsClesParCarte.set(carte, editeurMots);
        // Pas de champ unique à focaliser (une grille) : la clé permet quand même à
        // focaliserChamp() de retrouver le bloc par [data-cle], comme les autres champs.
        editeurMots.element.dataset.cle = 'keywords';
        carte.appendChild(editeurMots.element);
        attacherAutocompletionMotsCles(editeurMots, motsClesOpts);
        // Une pastille PAR LANGUE et non par mot : le champ traduisible est la liste
        // entière, et c'est elle qu'on propose autrement — une pastille par case en
        // donnerait quinze sur une carte à cinq mots-clés. Posées pour les trois langues et
        // cachées par la classe champ-<lang>, comme les intitulés (_fiches.css) : la colonne
        // d'une langue qu'on coche apporte ainsi sa pastille sans re-rendu. Pas de
        // champ-trad ici — les mots-clés ne se cachent pas avec les traductions.
        // La valeur part jointe par des retours à la ligne, un mot-clé par ligne.
        ordreAffichage().forEach(function (lg) {
          var p = pastilleTraduction(lMots, slug, 'keywords', lg, function () {
            return (editeurMots.collecterBrut()[lg] || [])
              .filter(function (m) { return String(m).trim() !== ''; }).join('\n');
          });
          if (p) { p.classList.add('champ-' + lg); }
        });
        // `editeurMots` n'existait pas encore au premier rendreChampsTextes() : ses
        // compteurs y ont ouvert sur zéro mot-clé. On les corrige ici, avant que la carte ne
        // quitte construireCarte() — rien de faux ne s'est donc affiché.
        majTousCompteursResume();
      }

      // Une case par langue manquante : « + Allemand (champs DE) » pour un article IT de
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
            // vivent dans son modèle et non dans le DOM. Pas de grille pour un chapitre
            // (ESTLIVRE) : rien à reconstruire.
            if (editeurMots) { editeurMots.reconstruire(colonnes()); }
            appeler('carteChangee', carte);
          });
          zoneCases.appendChild(caseLangue);
        });
      }
      rendreCases();
      poserClasses();

      // Changer la langue de l'article permute les contenus entre l'ancienne et la
      // nouvelle langue — titres, sous-titres, résumés et mots-clés : rien ne se perd,
      // les textes de l'ancienne langue passent sous la nouvelle et inversement. Une
      // fiche sans langue déclarée s'affiche sous la langue du numéro : le premier choix
      // permute donc depuis elle, puisque c'est là que les contenus étaient montrés.
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
        // editeurMots n'existe pas pour un chapitre (ESTLIVRE) : rien à permuter ni à
        // reconstruire côté mots-clés, seulement à défaut de grille.
        if (editeurMots) { editeurMots.permuter(ancienne, nouvelle); }
        langueArticle = nouvelle;
        // Les cases se recalculent : l'ancienne langue devient « manquante », cochée si
        // elle porte (encore) des contenus ; une case cochée à la main le reste.
        var anciennes = cochees;
        cochees = {};
        var brut = editeurMots ? editeurMots.collecterBrut() : {};
        languesManquantes().forEach(function (lg) {
          var contenu = champsMultilingues.some(function (cle) { return !!valeurs[cle][lg]; }) ||
            (brut[lg] || []).some(function (m) { return String(m).trim() !== ''; });
          cochees[lg] = contenu || !!anciennes[lg];
        });
        poserClasses();
        rendreChampsTextes(valeurs);
        rendreCases();
        if (editeurMots) { editeurMots.reconstruire(colonnes()); }
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
      var resultat = { type: '', lang: '', licence: '', doi: '', horsSommaire: false, title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };
      var sel = carte.querySelector('select[data-cle=type]');
      if (sel) { resultat.type = sel.value; }
      var selLangue = carte.querySelector('select[data-cle=lang]');
      if (selLangue) { resultat.lang = selLangue.value; }
      var selLicence = carte.querySelector('select[data-cle=licence]');
      if (selLicence) { resultat.licence = selLicence.value; }
      // Absente pour un article (ESTLIVRE faux) : la case n'existe alors pas dans le DOM,
      // et resultat.horsSommaire reste à false — jamais de `sommaire: non` écrit à sa place.
      var cocheSommaire = carte.querySelector('input[data-cle=sommaire]');
      if (cocheSommaire) { resultat.horsSommaire = !!cocheSommaire.checked; }
      // Le doi n'est collecté qu'en mode manuel : case décochée, la fiche repart sans
      // doi, et le calculé — que le champ affiche — ne s'écrit jamais nulle part.
      var cocheDoi = carte.querySelector('[data-cle="doi-manuel"]');
      var doiManuel = !!(cocheDoi && cocheDoi.checked);
      var entreeDoi = carte.querySelector('input[data-cle=doi]');
      if (entreeDoi) { resultat.doi = doiManuel ? entreeDoi.value : ''; }
      // Les champs multilingues, dans les trois langues : les colonnes non révélées
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

    // Amène un champ à l'écran et y pose le curseur (revue F03, boutons de constat).
    // `filtre` est celui du message « valeurs » — un focus n'a de sens que sur UNE carte, la
    // vue filtrée sur un seul article : sur « tous les articles », on ne devine rien. `cle`
    // vide, ou qui ne correspond à aucun [data-cle] de la carte, ne fait rien : la table
    // (lib/constats.js) porte des focusChamp qui n'ont pas tous leur pendant ici (« pièce »,
    // « chapitre », propres au formulaire du numéro/livre) — jamais d'erreur affichée.
    function focaliserChamp(filtre, cle) {
      var f = String(cle || '');
      if (f === '' || !/^[A-Za-z0-9_-]+$/.test(f)) { return; }
      if (!Array.isArray(filtre) || filtre.length !== 1) { return; }
      var carte = null;
      for (var c of conteneur.querySelectorAll('.carte')) {
        if (c.dataset.slug === filtre[0]) { carte = c; break; }
      }
      if (!carte) { return; }
      var el = carte.querySelector('[data-cle="' + f + '"]');
      if (!el) { return; }
      // La grille de mots-clés n'est pas elle-même saisissable : on pose le curseur sur sa
      // première case, mais on amène le bloc entier à l'écran (plus lisible qu'une case
      // isolée en haut de la fenêtre).
      var cible = (f === 'keywords' && el.querySelector) ? (el.querySelector('input, textarea') || el) : el;
      try { el.scrollIntoView({ block: 'center' }); } catch (e) { el.scrollIntoView(); }
      if (typeof cible.focus === 'function') { cible.focus(); }
    }

    // Traite les réponses de l'hôte qui concernent l'enregistrement et la photo. Rend
    // true si le message a été consommé, pour que la page n'ait pas à les connaître.
    // Course pret/valeurs : le « pret » de SZH.annoncerPret est redemandé toutes les
    // 350 ms tant que la page ne l'a pas confirmé ; sur un aller-retour lent, l'hôte peut
    // répondre deux fois à « pret » avant que la première réponse n'arrive, et la seconde
    // « valeurs » atterrirait alors après que le rédacteur a commencé à taper — la
    // reconstruire écraserait cette saisie. SZH.jetonDejaTraite (_commun.js) la reconnaît
    // au jeton que l'hôte recopie (msg.requete) et l'ignore, sauf si l'hôte la marque
    // `rechargement: true` — une fiche périmée doit alors se reconstruire quand même.
    function message(msg) {
      if (msg.type === SZH.MSG.VALEURS) {
        if (SZH.jetonDejaTraite(etatJeton, msg)) { return true; }
        SZH.poserAccent(msg.accent);
        // Le plafond des photos (modale partagée) et, pour la vérification d'import, celui
        // des originaux d'image : posé avant le rendu, jamais mis en cache localement.
        SZH.appliquerLimites(msg.limites);
        // Posé avant rendre() : les cartes construisent leurs pastilles au passage.
        VERIF_TRAD = msg.verifTrad === true;
        rendre(msg.articles || [], msg.types || [], msg.langue || 'fr',
          msg.licences || null, msg.licenceDefaut || null, msg.formeDoi || null, msg.estLivre === true);
        surValeurs(msg);
        if (msg.focus) { focaliserChamp(msg.filtre, msg.focus); }
        return true;
      }
      if (msg.type === SZH.MSG.ENREGISTRE) {
        if (minuteurEnr) { minuteurEnr.confirme(); }
        // Les marques ne sont retirées qu'après un enregistrement automatique : après un
        // enregistrement demandé, l'hôte renvoie les valeurs et la page se re-rend.
        if (msg.auto) { oublier(); }
        if (etat) { etat.textContent = TXT.enregistre.split('{0}').join(msg.n); }
        return true;
      }
      if (msg.type === SZH.MSG.ERREUR) {
        if (minuteurEnr) { minuteurEnr.confirme(); }
        if (etat) { etat.textContent = '⚠ ' + msg.message; }
        return true;
      }
      if (msg.type === SZH.MSG.DOI_MANUEL_REPONSE) {
        reponseDoi(msg);
        return true;
      }
      // Le vocabulaire edudoc.ch pour l'autocomplétion des mots-clés : gardé même reçu
      // avant que la première carte n'existe, comme auteurs-connus pour ctlAuteurs.
      if (msg.type === SZH.MSG.MOTS_CLES_CONNUS) {
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
        api.postMessage({ type: SZH.MSG.ENREGISTRER, auto: !!auto, articles: modifiees() });
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
    // Le bouton est un INTERRUPTEUR : son libellé ne bouge pas (WAI-ARIA : un bouton à
    // bascule garde son nom), l'oeil s'ouvre ou se ferme, aria-pressed suit, et
    // _design.css lui donne le fond plein quand les traductions sont à l'écran. Le geste à
    // venir passe en infobulle. Le gabarit HTML ne pose que le texte : c'est ici que
    // l'icône arrive, une fois SZH chargé — d'où la reconstruction du contenu.
    var traductionsVisibles = !!opts.traductionsVisibles;
    function traductions(bouton) {
      var poser = function () {
        conteneur.classList.toggle('sans-trad', !traductionsVisibles);
        if (!bouton) { return; }
        bouton.textContent = '';
        bouton.appendChild(SZH.icone(traductionsVisibles ? 'oeil' : 'oeil-ferme'));
        var texte = document.createElement('span');
        texte.textContent = TXT.tradBouton || '';
        bouton.appendChild(texte);
        bouton.title = traductionsVisibles ? (TXT.tradMasquer || '') : (TXT.tradAfficher || '');
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
      focaliserChamp: focaliserChamp,

      estModifie: function () { return modifies.size > 0; }
    };
  }

  SZH.cartesArticles = cartesArticles;
})();
