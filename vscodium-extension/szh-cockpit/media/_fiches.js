// Cartes de métadonnées d'article et modale photo, partagées par « Métadonnées des
// articles » et « Vérification de l'import ». Posé après _commun.js, sur ces deux pages
// seulement.
//
//   SZH.cartesArticles(opts)  construit et pilote les cartes d'un conteneur,
//                             l'enregistrement et l'affichage des traductions
//
// Les auteur·e·s sont affichés et édités par SZH.auteurs (_auteurs.js), partagé avec le
// gestionnaire des médias.

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
  // au nouveau rendu qui le vide. `surValeurs(msg)` l'est après le rendu d'un message
  // « valeurs », pour ce que la page ajoute autour des cartes. `traductionsVisibles` ouvre
  // les langues dès le départ, pour la vérification d'import, dont les badges « à
  // compléter » sont aussi dans les intitulés des traductions.
  //
  // Protocole avec l'hôte :
  //   hôte -> webview : valeurs { articles, types, licences, licenceDefaut, langue, accent,
  //                     formeDoi: { motif, exemple }, verifTrad, filtre, focus } ; formeDoi
  //                     est la forme des DOI de la revue du numéro (absente sur la page de
  //                     vérification d'import, voir champDoi) ; verifTrad dit si le
  //                     vérificateur de traduction est actif ; focus nomme un [data-cle] à
  //                     amener à l'écran, et n'a d'effet que si filtre vaut une seule carte
  //                     (voir focaliserChamp) ;
  //                     doi-manuel-reponse { slug, sens, ok } ;
  //                     mots-cles-connus { motsCles: [{ de, fr }] } (autocomplétion, voir
  //                     attacherAutocompletionMotsCles)
  //   webview -> hôte : doi-manuel-confirmer { slug, sens } ;
  //                     suggererTraduction { slug, champ, langue, valeur }
  // La partie photo est celle de _auteurs.js, à qui les messages sont passés.

  // ---- Autocomplétion des mots-clés : le vocabulaire edudoc.ch (lib/mots-cles-edudoc.js) --
  //
  // Reçu de l'hôte en paires bilingues { de, fr } (message mots-cles-connus). La grille de
  // mots-clés (SZH.motsCles, _commun.js) apparie « diagnostic » et « Diagnose » par
  // position : une rangée est un mot-clé, une colonne par langue. L'autocomplétion propose
  // dans la langue du champ où l'on tape (son data-langue). Choisir une suggestion pose
  // aussi, dans la case de l'autre langue de la même rangée, l'équivalent du thésaurus, en
  // remplaçant ce qui s'y trouvait : un mot-clé edudoc est une paire indivisible. Si le
  // thésaurus n'a pas d'équivalent (paire incomplète, champ `manque` côté hôte), l'autre
  // case n'est pas touchée. Les auteur·e·s suivent une autre règle (_auteurs.js) : une
  // correction tapée y est gardée, car on y complète une fiche éditable champ par champ.
  //
  // Pas de vocabulaire italien : lib/mots-cles-edudoc.js ne moissonne que DE/FR. Le champ
  // `it` n'a donc ni suggestion ni équivalent complété.
  //
  // Les paires incomplètes ne sont pas indexées dans la langue qui leur manque : pDe/pFr
  // valent alors null, et chercherMotsCles les saute.
  //
  // Écouteurs posés en délégation sur le conteneur de la grille (editeurMots.element), qui
  // n'est jamais remplacé : SZH.motsCles reconstruit son DOM interne à chaque ajout, retrait
  // ou permutation de rangée, et un écouteur posé sur un <input> serait perdu.
  //
  // ---- Le thésaurus comme chemin par défaut, et l'entrée « hors thésaurus » ----
  //
  // Les suggestions s'ouvrent dès le premier caractère. Quand aucun descripteur ne
  // correspond, la boîte montre une seule entrée, séparée par un filet (le « second
  // rideau ») : « Ajouter « … » hors thésaurus », qui permet un mot-clé hors vocabulaire. La
  // valeur tapée n'est jamais modifiée tant qu'on ne choisit pas cette entrée.
  //
  // Toute case non vide dont la valeur n'est pas un descripteur porte une pastille
  // (.mc-hors-thesaurus) : « ce mot-clé ne partira pas à l'export ». Ce marqueur n'est écrit
  // nulle part (ni dans le modèle de la grille, ni dans le .meta.yaml) : il se recalcule à
  // chaque affichage (appliquerMarqueurs, crochet opts.surRendu de SZH.motsCles), si bien
  // qu'un terme adopté plus tard par edudoc.ch cesse d'être signalé. Confirmer « ajouter
  // hors thésaurus » éteint la pastille de la case pour la durée du panneau, sans rien
  // enregistrer. Une case vide n'est pas marquée (elle porte le placeholder « à
  // traduire »), et l'italien n'a pas de marqueur.
  //
  // La pastille doit prédire l'export : sa règle doit rester celle de
  // lib/mots-cles-edudoc.js (indexerThesaurus, chercherDescripteur, apparierDescripteurs).
  // La webview n'a pas de require() : indexerThesaurusMc/chercherDescripteurMc/
  // pliDescripteurMc, plus bas, la réimplémentent à l'identique (deux passes, exactes puis
  // sans qualificatif ; même normalisation des apostrophes courbes et obliques). plierMc
  // (SZH.plier) plie casse, accents et espaces comme plierNom, d'où part plierDescripteur ;
  // pliDescripteurMc n'y ajoute que les apostrophes, pour ne pas toucher l'autocomplétion
  // des mots-clés et des auteur·e·s. test/js/mots-cles-grille.test.js compare les deux
  // moteurs sur un corpus de cas difficiles.

  // Casse, accents, positions et séparateurs de mot : le moteur de _commun.js (SZH.*),
  // partagé avec _auteurs.js ; les noms en Mc restent ici.
  var plierMc = SZH.plier;
  var plierAvecIndexMc = SZH.plierAvecIndex;
  var debutsDeMotMc = SZH.debutsDeMot;
  var chercherDebutMc = SZH.chercherDebut;
  var poserAvecGrasMc = SZH.poserAvecGras;

  // Les paires reçues de l'hôte, indexées une fois pour la recherche : pDe/pFr valent null
  // pour le côté manquant d'une paire incomplète, et chercherMotsCles les saute.
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

  // Les entrées qui correspondent à la saisie, pour 'fr' ou 'de'. Une saisie de plusieurs
  // mots doit tous les retrouver, chacun au début d'un mot du descripteur.
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
  // Ces fonctions réimplémentent plierDescripteur/indexerThesaurus/chercherDescripteur de
  // lib/mots-cles-edudoc.js, que la webview ne peut pas charger (voir l'en-tête).
  var RE_QUALIFICATIF_FINAL_MC = /\s*\([^()]*\)\s*$/;   // un seul groupe, en fin de chaîne

  // « Inklusion (SZH) » -> « Inklusion » ; un texte sans parenthèse finale ressort inchangé.
  function sansQualificatifFinalMc(texte) {
    return String(texte === undefined || texte === null ? '' : texte).replace(RE_QUALIFICATIF_FINAL_MC, '');
  }

  // plierMc (SZH.plier) plie casse, accents et espaces comme plierNom, d'où part
  // plierDescripteur ; on ajoute ici la normalisation des trois apostrophes courbes ou
  // obliques vers l'apostrophe droite.
  function pliDescripteurMc(texte) {
    return plierMc(String(texte === undefined || texte === null ? '' : texte).replace(/[’‘ʼ]/g, "'"));
  }

  // Deux passes, comme indexerThesaurus : toutes les clés exactes d'abord, puis les clés
  // sans qualificatif, qui ne remplacent jamais une clé exacte. `connus` est le tableau de
  // construireIndexMotsCles, dans l'ordre du cache envoyé par « mots-cles-connus » : les
  // collisions se résolvent comme côté hôte.
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

  // Exact d'abord, sans qualificatif ensuite, comme chercherDescripteur.
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
  // La maquette imprime les deux résumés d'un article et ses mots-clés sur la première
  // page ; au-delà d'un certain nombre de caractères, un résumé passe en page 2. Le seuil
  // dépend du nombre de mots-clés de la même langue (imprimés sur la même page) : 3 à 5
  // tiennent sur une ligne (bascule vers 830 caractères), 6 à 10 sur deux (vers 730),
  // d'après la compilation de 58 articles d'essai.
  //
  // La recommandation reste en deçà : 750 jusqu'à 5 mots-clés, 700 dès le sixième. Le
  // compteur informe sans bloquer l'enregistrement. `SEUIL_MOTS_CLES_PALIER` est la seule
  // marche de cet escalier.
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
    // Les auteur·e·s d'une carte sont dans ce modèle, et non dans le DOM : la fiche affichée
    // est statique, la modale édite le modèle et collecter() le relit.
    var auteursParCarte = new WeakMap();
    var apercusParCarte = new WeakMap();
    var TYPES = [];
    var LANGUE_DEFAUT = 'fr';
    // Licences offertes et licence par défaut : listes fermées venues de l'hôte, comme les
    // types d'article.
    var LICENCES = [];
    var LICENCE_DEFAUT = '';
    // La forme des DOI de la revue du numéro : { motif, exemple }, envoyée une fois par
    // l'hôte (message valeurs), voir champDoi(). Absente sur la page de vérification
    // d'import : reste null, et la note de forme ne s'y affiche pas.
    var FORME_DOI_ACTUELLE = null;
    // Les capacités du profil (message valeurs, msg.capacites, lib/profil.js) : elles
    // décident des champs qu'une carte construit. Une page qui ne les envoie pas a la carte
    // d'un article de revue, d'où les deux formes de test : `CAP.x !== false` pour un champ
    // de la revue, `CAP.x === true` pour un champ du livre.
    var CAP = {};
    // ---- Le vérificateur de traduction ----
    //
    // Un mode posé par l'hôte dans le message « valeurs » (réglage du poste,
    // lib/archivage.js#lireVerifTraduction). Actif, chaque champ traduisible (titre,
    // sous-titre, résumé, mots-clés, par langue) reçoit à côté de son intitulé une pastille
    // qui ouvre le formulaire de suggestion. La carte s'édite et s'enregistre normalement,
    // et une suggestion ne modifie aucun texte. Un changement de réglage s'applique au
    // prochain message « valeurs », qui reconstruit les cartes.
    var VERIF_TRAD = false;
    // Le vocabulaire edudoc.ch (message mots-cles-connus), partagé par toutes les cartes de
    // la page.
    var motsClesConnus = [];
    // L'index de reconnaissance (pastille « hors thésaurus »), distinct de motsClesConnus,
    // qui sert la recherche par préfixe de l'autocomplétion. Voir l'en-tête.
    var indexThesaurusMc = null;
    // Les grilles de mots-clés affichées (une par carte). Le vocabulaire peut arriver après
    // les cartes (l'hôte envoie « valeurs » avant « mots-cles-connus », voir
    // envoyerValeurs/envoyerMotsClesConnus dans lib/metadonnees-hote.js) : cette liste
    // permet de reposer alors les pastilles. Vidée à chaque rendre() complet, qui recrée
    // toutes les cartes.
    var reappliquerTousLesMarqueurs = [];
    function poserMotsClesConnus(liste) {
      motsClesConnus = construireIndexMotsCles(liste);
      indexThesaurusMc = indexerThesaurusMc(motsClesConnus);
      for (var i = 0; i < reappliquerTousLesMarqueurs.length; i++) { reappliquerTousLesMarqueurs[i](); }
    }

    // La modale rend l'auteur·e édité, sans l'écrire sur le disque : la carte garde la main
    // sur son enregistrement.
    var ctlAuteurs = SZH.auteurs({
      api: api,
      txt: TXT,
      // La première frappe marque la carte : sinon un rechargement demandé ailleurs (l'icône
      // ✎ d'un autre article) jetterait la saisie de la modale, la garde de l'hôte ne
      // connaissant que les cartes marquées.
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

    // La pastille du vérificateur, dans l'intitulé et non dans le champ : elle ne doit ni
    // rétrécir la zone de saisie ni s'intercaler dans la tabulation entre l'intitulé et son
    // champ. `lireValeur` est appelée au clic : l'hôte reçoit ce qui est à l'écran, frappe
    // en cours comprise.
    function pastilleTraduction(parent, slug, champ, langue, lireValeur) {
      if (!VERIF_TRAD || !langue) { return null; }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'szh-sugg-trad';
      b.title = TXT.suggPastille || '';
      b.setAttribute('aria-label', (TXT.suggPastille || '') + ' – ' + champ + ' ' + langue.toUpperCase());
      // Le code de langue en capitales plutôt que l'icône ICONES.traduction, illisible à la
      // taille d'un intitulé : deux capitales restent lisibles et disent la langue visée.
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

    // `traduction` marque les champs d'une autre langue que celle de l'article : cachés par
    // défaut, révélés par le bouton de la barre, pour garder la carte courte.
    // `croissant` : titre ou sous-titre d'un chapitre, une ligne au départ, qui grandit ;
    // Entrée y force un retour à la ligne (l'hôte l'écrit « // »).
    function champTexte(carte, parent, slug, cle, langue, libelle, valeur, multiligne, traduction, croissant) {
      var l = document.createElement('label');
      l.textContent = libelle;
      appeler('champ', l, langue ? cle + '.' + langue : cle);
      var i = document.createElement(multiligne || croissant ? 'textarea' : 'input');
      if (croissant) {
        i.rows = 1;
        i.style.resize = 'none';
        i.style.overflow = 'hidden';
        i._ajuster = function () {
          i.style.height = 'auto';
          if (i.scrollHeight) { i.style.height = i.scrollHeight + 'px'; }
        };
        i.addEventListener('input', i._ajuster);
      } else if (multiligne) { i.rows = 3; } else { i.type = 'text'; }
      i.value = valeur || '';
      if (i._ajuster) { i._ajuster(); }
      i.dataset.cle = cle;
      if (langue) { i.dataset.langue = langue; l.classList.add('champ-' + langue); i.classList.add('champ-' + langue); }
      if (traduction) { l.classList.add('champ-trad'); i.classList.add('champ-trad'); }
      // Les quatre champs traduisibles de la fiche sont title, subtitle, resume et keywords
      // (lib/traduction.js) ; les trois premiers passent par ici, les mots-clés ont leur
      // propre pastille. La pastille suit l'intitulé, donc son affichage.
      pastilleTraduction(l, slug, cle, langue, function () { return i.value; });
      i.addEventListener('input', function () { marquer(carte, slug); });
      parent.appendChild(l);
      parent.appendChild(i);
      return i;                    // le résumé y accroche son compteur de caractères
    }

    // ---- Le champ DOI : calculé et verrouillé, sauf échappatoire ----
    //
    // L'hôte envoie le DOI calculé (article.doiCalcule) et le champ l'affiche en lecture
    // seule, « — » quand il est incalculable ou que l'article n'en reçoit pas. La case
    // « Définir manuellement le DOI » permet de le saisir ; la webview n'a pas de boîte de
    // dialogue, la confirmation passe par l'hôte :
    //
    //   webview -> hôte : doi-manuel-confirmer { slug, sens: 'activer' | 'retirer' }
    //   hôte -> webview : doi-manuel-reponse { slug, sens, ok }
    //
    // La case revient en arrière dès le clic, et la réponse rejoue l'action ; entre les
    // deux, l'utilisateur répond à la question modale de l'hôte. Une fiche qui porte déjà un
    // doi est en mode manuel d'office.
    //
    // Deux notes, non bloquantes (seul l'export refuse) :
    //   - la forme : FORME_DOI_ACTUELLE (motif et exemple de la revue du numéro) contre la
    //     valeur tapée, revérifiée à chaque frappe et retirée quand la case se décoche ou
    //     que la saisie redevient bonne ;
    //   - l'unicité : verifierDoublonsDoi() compare, à chaque frappe, le DOI effectif de
    //     toutes les cartes du conteneur (manuel actif, sinon calculé) et signale celles dont
    //     le manuel coïncide avec une autre. doiParCarte garde les éléments nécessaires.
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
      // Posé avant le premier poser() : verifierDoublonsDoi() parcourt toutes les cartes,
      // celle-ci comprise, et doit la trouver dans doiParCarte dès le premier appel.
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
    // revenue en arrière. Accord : le champ s'ouvre prérempli du calculé, ou se referme en
    // effaçant le DOI manuel.
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
    // En délégation (voir l'en-tête) : un seul écouteur par événement, qui survit aux
    // reconstructions internes de SZH.motsCles.
    function attacherAutocompletionMotsCles(editeurMots, motsClesOpts) {
      var conteneurMc = editeurMots.element;
      var boiteSugg = document.createElement('div');
      boiteSugg.className = 'szh-sugg';
      boiteSugg.hidden = true;
      boiteSugg.setAttribute('role', 'listbox');
      boiteSugg.setAttribute('aria-label', TXT.motsClesSuggestions || '');
      var suggEtat = { input: null, items: [], actif: -1 };
      var enSelection = false;               // vrai pendant qu'on écrit nous-mêmes une valeur

      // ---- La pastille « hors thésaurus » : un signal, sans rien modifier ----
      //
      // Voir l'en-tête du fichier. `confirmesHorsThesaurus` est propre à cette grille (une
      // carte) et ne survit pas à un nouveau rendu complet : la confirmation vaut pour la
      // session.
      var confirmesHorsThesaurus = {};   // 'fr::cléPliée' -> true

      function cleConfirmation(langueCode, valeur) { return langueCode + '::' + pliDescripteurMc(valeur); }

      // Une case a besoin du marqueur si : sa langue a un vocabulaire (pas l'italien), elle
      // n'est pas vide, elle n'a pas été confirmée hors thésaurus pendant la session, et le
      // descripteur trouvé, s'il y en a un, n'est pas complet dans les deux langues (même
      // règle que apparierDescripteurs à l'export).
      function marqueurNecessaire(valeur, langueCode) {
        if (langueCode !== 'fr' && langueCode !== 'de') { return false; }
        var s = String(valeur === undefined || valeur === null ? '' : valeur).trim();
        if (s === '') { return false; }
        if (confirmesHorsThesaurus[cleConfirmation(langueCode, s)]) { return false; }
        var trouve = chercherDescripteurMc(s, indexThesaurusMc || {});
        return !(trouve && trouve.de !== '' && trouve.fr !== '');
      }

      // Repose tous les marqueurs de cette grille, retirés puis recréés : rendre()
      // (_commun.js) reconstruit tout le DOM interne à chaque ajout, retrait ou permutation de
      // rangée, et une grille de mots-clés est assez courte pour que ce soit bon marché.
      function appliquerMarqueurs() {
        var anciens = conteneurMc.querySelectorAll('.mc-hors-thesaurus');
        for (var k = 0; k < anciens.length; k++) { anciens[k].remove(); }
        // Sous « .mc » : la rangée d'en-tête ne porte que des <span>, pas d'<input>.
        var champs = conteneurMc.querySelectorAll('.mc input[data-langue]');
        for (var c = 0; c < champs.length; c++) {
          var champ = champs[c];
          if (!marqueurNecessaire(champ.value, champ.dataset.langue)) { continue; }
          var rangee = champ.closest('.mc-rangee');
          if (!rangee) { continue; }
          var marque = document.createElement('span');
          marque.className = 'mc-hors-thesaurus';
          // La langue en donnée : les pastilles des cases FR et DE sont enfants de la même
          // rangée, et doivent se distinguer.
          marque.dataset.langue = champ.dataset.langue;
          marque.setAttribute('role', 'img');
          marque.setAttribute('aria-label', TXT.motsClesHorsThesaurus || '');
          marque.title = TXT.motsClesHorsThesaurus || '';
          // Positionnée comme la boîte de suggestions (offsetLeft/offsetWidth du champ) : la
          // largeur des colonnes dépend des langues affichées.
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

      // Le crochet d'après-rendu (SZH.motsCles, _commun.js) : rendre() reconstruit le DOM
      // interne à chaque ajout ou retrait de rangée, à la permutation des langues ou au
      // changement des colonnes affichées, et les marqueurs doivent être reposés après.
      // `motsClesOpts` est l'objet passé au constructeur de SZH.motsCles ; on le complète ici
      // parce que le premier rendre() a lieu pendant la construction. L'appel immédiat en fin
      // d'attacherAutocompletionMotsCles couvre ce premier rendu.
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

      // Choisir une suggestion remplace le champ où l'on tape, et pose l'équivalent du
      // thésaurus dans la case de l'autre langue de la même rangée, en remplaçant ce qui s'y
      // trouvait, sauf si la paire est incomplète. Voir l'en-tête.
      function choisir(trouve, langueCode, input) {
        enSelection = true;
        var e = trouve.entree;
        input.value = langueCode === 'fr' ? e.fr : e.de;
        // Un événement synthétique, que SZH.motsCles écoute pour reprendre la valeur dans son
        // modèle et prévenir onChange (qui marque la carte modifiée) : une affectation de
        // .value ne déclenche aucun écouteur.
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
        // L'italien n'a pas de vocabulaire edudoc.ch : rien à proposer.
        if (langueCode !== 'fr' && langueCode !== 'de') { fermerSuggestions(); return; }
        var saisieBrute = input.value.trim();
        var saisie = plierMc(input.value);
        // Dès le premier caractère : le thésaurus est le chemin par défaut de la saisie.
        if (motsClesConnus.length === 0 || saisie.length < 1) { fermerSuggestions(); return; }
        var trouves = chercherMotsCles(motsClesConnus, langueCode, saisie);
        fermerSuggestions();
        var rangee = input.closest('.mc-rangee');
        if (!rangee) { return; }
        suggEtat = { input: input, items: [], actif: -1 };
        if (trouves.length === 0) {
          // Aucun descripteur ne correspond. La valeur tapée n'est pas touchée : seul un clic
          // ou Entrée sur cette entrée la confirme hors thésaurus (confirmerHorsThesaurus) ;
          // en attendant, la pastille de la case le signale (appliquerMarqueurs, appelée
          // ensuite).
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
              // mousedown neutralisé : le clic ne doit pas voler le focus du champ.
              b.addEventListener('mousedown', function (e) { e.preventDefault(); });
              b.addEventListener('click', function () { choisir(t, langueCode, input); });
              boiteSugg.appendChild(b);
              suggEtat.items.push({ element: b, trouve: t });
            })(trouves[i]);
          }
        }
        // Positionnée sous la case où l'on tape, et non sous la rangée entière : .mc-rangee
        // est en position relative (_fiches.css) et l'input en est un enfant direct, donc son
        // offsetLeft/offsetWidth suffisent.
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
          // Seule la liste se ferme : la propagation est coupée, comme pour l'autocomplétion
          // des auteur·e·s (_auteurs.js).
          e.preventDefault();
          if (e.stopPropagation) { e.stopPropagation(); }
          fermerSuggestions();
        }
      }

      conteneurMc.addEventListener('input', function (e) {
        var input = e.target;
        if (!input || input.tagName !== 'INPUT' || !input.dataset.langue) { return; }
        majSuggestions(input);
        // La valeur vient de changer : les marqueurs de la grille sont reposés aussitôt, sans
        // aller-retour vers l'hôte.
        appliquerMarqueurs();
      });
      conteneurMc.addEventListener('keydown', function (e) {
        var input = e.target;
        if (!input || input.tagName !== 'INPUT' || !input.dataset.langue) { return; }
        clavierSuggestions(e, input);
      });
      // focusout (et non blur) : il remonte jusqu'au conteneur, où l'écouteur est posé. Le
      // mousedown neutralisé sur chaque suggestion garde le focus sur le champ pendant le
      // clic, comme pour les auteur·e·s.
      conteneurMc.addEventListener('focusout', function () { fermerSuggestions(); });

      // La grille est inscrite pour suivre un vocabulaire arrivé plus tard (voir
      // reappliquerTousLesMarqueurs). L'appel immédiat couvre le rendu qui vient d'avoir
      // lieu : un mot-clé hors thésaurus se voit sans attendre une frappe.
      reappliquerTousLesMarqueurs.push(appliquerMarqueurs);
      appliquerMarqueurs();
    }

    // ---- Construction des cartes ----

    function rendre(articles, types, langueDefaut, licences, licenceDefaut, formeDoi, capacites) {
      if (types) { TYPES = types; }
      if (langueDefaut) { LANGUE_DEFAUT = langueDefaut; }
      if (licences) { LICENCES = licences; }
      if (licenceDefaut) { LICENCE_DEFAUT = licenceDefaut; }
      FORME_DOI_ACTUELLE = formeDoi || null;
      CAP = capacites || {};
      ctlAuteurs.fermer();                           // re-rendu : la fiche visée disparaît
      conteneur.textContent = '';
      modifies.clear();
      // Toutes les cartes vont être recréées ; chaque grille se réinscrira dans cette liste
      // (attacherAutocompletionMotsCles).
      reappliquerTousLesMarqueurs = [];
      surChangement();
      for (var n = 0; n < articles.length; n++) {
        var carte = construireCarte(articles[n]);
        conteneur.appendChild(carte);
        appeler('finCarte', carte, articles[n]);
      }
      // Un DOI manuel peut déjà coïncider avec un autre à l'ouverture (fiche recopiée d'un
      // article à l'autre) : la note s'affiche sans attendre la première frappe.
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
      // L'ordre d'affichage suit l'article : sa langue d'abord, puis la langue par défaut de
      // la revue (FR pour la Revue, DE pour la Zeitschrift) comme langue de traduction. Les
      // langues restantes de {fr, de, it} sont les « manquantes » : une case à cocher
      // chacune, cochée d'office quand la fiche porte déjà des contenus dans cette langue.
      // Tous les champs sont construits, dans cet ordre ; le CSS ne montre que les langues
      // dont la carte porte la classe avec-<lang>. Une fiche sans `lang` s'affiche sous la
      // langue du numéro, comme le sélecteur et szh-maquette.lua.
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
      // Une langue manquante qui a déjà des contenus s'affiche d'office.
      var cochees = {};
      languesManquantes().forEach(function (lg) {
        cochees[lg] = champsMultilingues.some(function (c) { return v[c] && v[c][lg]; }) ||
          !!(v.keywords && v.keywords[lg] && v.keywords[lg].length > 0);
      });

      // Type : seulement pour un article (éditorial, documentation…) ; un livre n'a pas de
      // taxonomie. Sans CAP.typeArticle, le champ est absent et la clé est gardée telle
      // quelle à l'enregistrement (nettoyerCarte(), lib/metadonnees-hote.js, ne l'efface que
      // pour un article).
      if (CAP.typeArticle !== false) {
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

      // Langue de l'article : elle prime au rendu sur celle du numéro. Le <select> vient de
      // SZH.choixLangue (_commun.js). La changer permute les contenus entre l'ancienne et la
      // nouvelle langue (voir changerLangue()).
      var langue = SZH.choixLangue({
        valeur: v.lang, defaut: LANGUE_DEFAUT,
        textes: { libelle: TXT.langueArticle, fr: TXT.langueFr, de: TXT.langueDe, it: TXT.langueIt },
        onChange: function (nouvelle) { changerLangue(nouvelle); }
      });
      appeler('champ', langue.label, 'lang');
      carte.appendChild(langue.label);
      carte.appendChild(langue.select);

      // Licence de l'article : CC-BY 4.0 sauf mention contraire ; une reprise sous droits se
      // déclare ici. Même composant que la langue, liste et libellés venant de l'hôte. Un
      // livre a une licence pour l'ouvrage entier : absente sans CAP.licence, avec la même
      // conservation de la clé que le type.
      if (CAP.licence !== false) {
        var licence = SZH.choixFerme({
          cle: 'licence', libelle: TXT.licence, options: LICENCES,
          valeur: v.licence, defaut: LICENCE_DEFAUT,
          onChange: function () { marquer(carte, slug); }
        });
        appeler('champ', licence.label, 'licence');
        carte.appendChild(licence.label);
        carte.appendChild(licence.select);
      }

      // Hors sommaire : livre seulement (la clé `sommaire:` n'existe pas dans une fiche
      // d'article, voir lib/yaml.js). Cochée, le chapitre perd numéro, pastille et marque de
      // tranche, et les autres se renumérotent ; c'est pipeline/profils/livre.mk
      // (CHAPITRES_HORS_SOMMAIRE) qui le fait à la compilation, la case écrit la clé.
      if (CAP.horsSommaire === true) {
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
      // `editeurMots` n'existe pas encore au premier rendu : le seuil calculé ici avec zéro
      // mot-clé est provisoire, et `majTousCompteursResume()` le corrige dès que la grille
      // existe, avant que la carte soit posée dans la page.
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
        // Une teinte avant le seuil, une autre au seuil ou au-delà ; l'enregistrement n'en
        // tient pas compte.
        c.el.classList.toggle('compteur-resume--proche', n >= seuil * 0.9 && n < seuil);
        c.el.classList.toggle('compteur-resume--depasse', n >= seuil);
      }
      function majTousCompteursResume() {
        for (var lg in compteursResume) {
          if (Object.prototype.hasOwnProperty.call(compteursResume, lg)) { majCompteurResume(lg); }
        }
      }
      // Capture lg par appel : un écouteur posé dans la boucle ci-dessous verrait sinon la
      // dernière langue de la boucle.
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
              (valeurs[textes[c][0]] || {})[lg], textes[c][2], traduction,
              CAP.titreEnLignes === true && textes[c][0] !== 'resume');
            // Livre seulement : Entrée force un retour à la ligne dans un titre de chapitre,
            // comme dans celui du livre (_numero.js, champ.aide).
            if (CAP.titreEnLignes === true && textes[c][0] !== 'resume' && TXT.brAide) {
              var aideBr = document.createElement('p');
              aideBr.className = 'champ-aide champ-' + lg + (traduction ? ' champ-trad' : '');
              aideBr.textContent = TXT.brAide;
              zoneTextes.appendChild(aideBr);
            }
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

      // Le DOI (calculé ou manuel) : pas pour un chapitre, un livre n'ayant pas d'export
      // OJS (doisCalculesArticles() ne calcule rien pour lui). `champDoi` inscrit ses
      // contrôles dans doiParCarte ; ses lecteurs (doiEffectifCarte, verifierDoublonsDoi,
      // collecter) tolèrent son absence.
      if (CAP.doi !== false) { champDoi(carte, slug, article); }

      // Mots-clés edudoc : pas pour un chapitre (pas de classification par sujet pour un
      // livre). `var editeurMots` reste déclarée (hissage) pour compterMotsClesLangue() et
      // changerLangue(), qui tolèrent son absence.
      var editeurMots;
      if (CAP.motsCles !== false) {
        // On ajoute et on retire une rangée entière, jamais un mot dans une seule langue,
        // la position seule appariant « diagnostic » et « Diagnose ».
        var lMots = document.createElement('label');
        lMots.textContent = TXT.motsClesTitre || '';
        appeler('motsCles', lMots, ordreAffichage(), noms);
        carte.appendChild(lMots);
        var colonnes = function () {
          return languesVisibles().map(function (l) { return { code: l, libelle: noms[l] }; });
        };
        // SZH.motsCles : la grille vit dans _commun.js, une autre IIFE ; sans le préfixe,
        // l'appel lève une ReferenceError.
        var motsClesOpts = {
          langues: colonnes(),
          listes: v.keywords || {},
          edition: true,
          textes: {
            motCle: TXT.motsCles, ajouter: TXT.motCleAjouter,
            retirer: TXT.motCleRetirer, aTraduire: TXT.motCleATraduire
          },
          // Un mot-clé ajouté, retiré ou vidé peut changer de palier (voir seuilResume) : les
          // compteurs des résumés suivent en direct, dans les deux sens.
          onChange: function () { marquer(carte, slug); majTousCompteursResume(); }
          // surRendu est posé par attacherAutocompletionMotsCles, juste en dessous, qui repose
          // la pastille « hors thésaurus » après chaque reconstruction.
        };
        editeurMots = SZH.motsCles(motsClesOpts);
        motsClesParCarte.set(carte, editeurMots);
        // Pas de champ unique à focaliser (une grille) : la clé permet à focaliserChamp() de
        // retrouver le bloc par [data-cle].
        editeurMots.element.dataset.cle = 'keywords';
        carte.appendChild(editeurMots.element);
        attacherAutocompletionMotsCles(editeurMots, motsClesOpts);
        // Une pastille par langue et non par mot : le champ traduisible est la liste entière.
        // Posées pour les trois langues et cachées par la classe champ-<lang>, comme les
        // intitulés (_fiches.css) : cocher une langue fait apparaître sa pastille sans nouveau
        // rendu. Pas de champ-trad : les mots-clés ne se cachent pas avec les traductions. La
        // valeur part jointe par des retours à la ligne, un mot-clé par ligne.
        ordreAffichage().forEach(function (lg) {
          var p = pastilleTraduction(lMots, slug, 'keywords', lg, function () {
            return (editeurMots.collecterBrut()[lg] || [])
              .filter(function (m) { return String(m).trim() !== ''; }).join('\n');
          });
          if (p) { p.classList.add('champ-' + lg); }
        });
        // Au premier rendreChampsTextes(), `editeurMots` n'existait pas encore et les
        // compteurs ont compté zéro mot-clé : on les corrige avant que construireCarte() ne
        // rende la carte.
        majTousCompteursResume();
      }

      // Une case par langue manquante : « + Allemand (champs DE) » pour un article IT de
      // la Revue, « + Français » et « + Italien » pour un article DE de la Zeitschrift.
      // Cocher révèle la colonne ; la carte n'est pas marquée modifiée, les valeurs restent.
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
            // La colonne apparaît ou disparaît ; le fragment garde ses valeurs dans son
            // modèle. Pas de grille pour un chapitre (CAP.motsCles).
            if (editeurMots) { editeurMots.reconstruire(colonnes()); }
            appeler('carteChangee', carte);
          });
          zoneCases.appendChild(caseLangue);
        });
      }
      rendreCases();
      poserClasses();

      // Changer la langue de l'article permute les contenus (titres, sous-titres, résumés et
      // mots-clés) entre l'ancienne et la nouvelle langue. Une fiche sans langue déclarée
      // s'affiche sous la langue du numéro : le premier choix permute depuis celle-ci. Rien
      // ne s'écrit ici : l'enregistrement normal de la carte emporte l'état permuté.
      function changerLangue(nouvelle) {
        var ancienne = langueArticle;
        if (ORDRE_LANGUES.indexOf(nouvelle) === -1 || nouvelle === ancienne) {
          marquer(carte, slug);
          return;
        }
        // Relire l'écran d'abord, pour garder une frappe en cours, puis échanger les deux
        // langues dans ce modèle.
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
        // editeurMots n'existe pas pour un chapitre (CAP.motsCles) : rien à permuter côté
        // mots-clés.
        if (editeurMots) { editeurMots.permuter(ancienne, nouvelle); }
        langueArticle = nouvelle;
        // Les cases se recalculent : l'ancienne langue devient « manquante », cochée si elle
        // porte des contenus ; une case cochée à la main le reste.
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
    // quelqu'un, et une fiche affichée n'a pas d'état à garder.
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
      // Une personne s'ajoute par la modale : une fiche vide dans la liste serait enregistrée
      // telle quelle.
      ajouter.addEventListener('click', function () {
        ctlAuteurs.ouvrir({
          slug: slug, index: (auteursParCarte.get(carte) || []).length, auteur: {},
          carte: carte, apercus: apercusParCarte.get(carte) || []
        });
      });
      zone.appendChild(ajouter);
      // Le focus revient sur la fiche éditée : le bouton d'origine a été retiré par ce
      // nouveau rendu, et le clavier repartirait du haut de la page.
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
      // Absente pour un article (CAP.horsSommaire faux) : resultat.horsSommaire reste à
      // false, et `sommaire: non` n'est pas écrit.
      var cocheSommaire = carte.querySelector('input[data-cle=sommaire]');
      if (cocheSommaire) { resultat.horsSommaire = !!cocheSommaire.checked; }
      // Le doi n'est collecté qu'en mode manuel : case décochée, la fiche repart sans doi, et
      // le calculé affiché n'est pas écrit.
      var cocheDoi = carte.querySelector('[data-cle="doi-manuel"]');
      var doiManuel = !!(cocheDoi && cocheDoi.checked);
      var entreeDoi = carte.querySelector('input[data-cle=doi]');
      if (entreeDoi) { resultat.doi = doiManuel ? entreeDoi.value : ''; }
      // Les champs multilingues, dans les trois langues, colonnes cachées comprises.
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

    // Amène un champ à l'écran et y pose le curseur. `filtre` est celui du message
    // « valeurs » : un focus n'a de sens que dans la vue filtrée sur un seul article. Une
    // `cle` vide ou sans [data-cle] correspondant est ignorée : lib/constats.js porte des
    // focusChamp propres au formulaire du numéro ou du livre (« pièce », « chapitre »).
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
      // La grille de mots-clés n'est pas saisissable en bloc : le curseur va sur sa première
      // case, et le bloc entier est amené à l'écran.
      var cible = (f === 'keywords' && el.querySelector) ? (el.querySelector('input, textarea') || el) : el;
      try { el.scrollIntoView({ block: 'center' }); } catch (e) { el.scrollIntoView(); }
      if (typeof cible.focus === 'function') { cible.focus(); }
    }

    // Traite les réponses de l'hôte sur l'enregistrement et la photo ; rend true si le
    // message a été consommé.
    // Course pret/valeurs : SZH.annoncerPret renvoie « pret » toutes les 350 ms tant que la
    // page ne l'a pas confirmé. Sur un aller-retour lent, l'hôte peut répondre deux fois, et
    // la seconde « valeurs » arriverait pendant la saisie, qu'elle écraserait.
    // SZH.jetonDejaTraite (_commun.js) la reconnaît au jeton recopié par l'hôte
    // (msg.requete) et l'ignore, sauf si l'hôte la marque `rechargement: true`.
    function message(msg) {
      if (msg.type === SZH.MSG.VALEURS) {
        if (SZH.jetonDejaTraite(etatJeton, msg)) { return true; }
        SZH.poserAccent(msg.accent);
        // Le plafond des photos (modale partagée) et, pour la vérification d'import, celui
        // des originaux d'image : posé avant le rendu.
        SZH.appliquerLimites(msg.limites);
        // Posé avant rendre() : les cartes construisent leurs pastilles au passage.
        VERIF_TRAD = msg.verifTrad === true;
        rendre(msg.articles || [], msg.types || [], msg.langue || 'fr',
          msg.licences || null, msg.licenceDefaut || null, msg.formeDoi || null, msg.capacites || null);
        surValeurs(msg);
        if (msg.focus) { focaliserChamp(msg.filtre, msg.focus); }
        return true;
      }
      if (msg.type === SZH.MSG.ENREGISTRE) {
        if (minuteurEnr) { minuteurEnr.confirme(); }
        // Les marques ne sont retirées qu'après un enregistrement automatique : après un
        // enregistrement demandé, l'hôte renvoie les valeurs et la page refait son rendu.
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
      // Le vocabulaire edudoc.ch pour l'autocomplétion des mots-clés, gardé même s'il arrive
      // avant la première carte.
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

    // Traductions : cachées au départ, mots-clés exceptés, pour garder les cartes courtes.
    // L'état est porté par le conteneur, pour survivre au nouveau rendu qui recrée les
    // cartes. Le bouton est un interrupteur : son libellé ne change pas (un bouton à bascule
    // WAI-ARIA garde son nom), l'œil s'ouvre ou se ferme, aria-pressed suit, et _design.css
    // lui donne le fond plein quand les traductions sont visibles. L'action à venir est en
    // infobulle. Le gabarit HTML ne pose que le texte ; l'icône est ajoutée ici une fois SZH
    // chargé, d'où la reconstruction du contenu.
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
