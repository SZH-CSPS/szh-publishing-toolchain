// Vue « Articles » : l'ordre du numéro, l'avancement de chaque article, et les
// métadonnées du numéro. Trois choses au même endroit parce qu'on les regarde ensemble
// quand on monte un numéro.
//
// Rien n'est décidé ici. Les cartes sont posées par SZH.listeCartes et la barre par
// SZH.barreBoutons (media/_commun.js), les mêmes que « Traductions » et « Word en
// attente ». Le formulaire du numéro est SZH.formulaireNumero (media/_numero.js), le même
// que la page « Méta-données du numéro » : un champ ajouté à sa table apparaît ici sans
// seconde modification.
//
// Les INTITULÉS des tâches ne se règlent plus ici. Ils décrivent le processus éditorial
// d'une revue et valent pour toute la rédaction : ils ont rejoint les réglages protégés,
// dans « Réglages SZH » (lib/reglages-proteges.js). Le bouton de la barre est devenu un
// aiguillage, comme « Changer la langue de l'article » sur la fiche : il dit où se fait le
// geste. Cette page ne garde que les CASES à cocher, qui, elles, sont propres à un article.
//
// L'aperçu des métadonnées, lui, est propre à cette page — il n'existe nulle part
// ailleurs : partout ailleurs, les métadonnées d'un article sont un formulaire. Ici on
// regarde, on ne saisit pas, et les deux boutons du pied mènent aux formulaires qui, eux,
// écrivent. La carte reste celle de SZH.listeCartes : cette page n'en refait pas une, elle
// insère son aperçu dedans.
//
// Protocole. Vers l'hôte :
//   pret ; ouvrir { cle } ; action { cle, id } ; tache { cle, id, cochee } ;
//   sansdoi { cle, coche } ; commande { id } ;
//   enregistrer { auto, modifies } ; couverture-deposer { nomFichier, donneesBase64 }
// Depuis l'hôte :
//   valeurs { titre, boutons, lignes, accent, valeurs, couverture, taches, metaRepliees,
//             ordre } ;
//   etat { message } ; avancement { cle, pastilles } ; enregistre ; erreur { message } ;
//   couverture { nom, description, apercu }
// où une ligne vaut { cle, titre, meta, notif, pastilles, ouvrir, actions, taches,
//                     apercu, constats, sansDoi, ordre } ,
//   apercu   = { lignes: [{ libelle, valeurs: [{ marque, texte, marques, ton }] }] }
//   constats = [{ ton, texte }] — posés par SZH.listeCartes dans l'encadré « À faire »
//   sansDoi  = { coche, verrouille }
//   ordre    = { monter, descendre } — { desactive, tip, ariaLabel } chacun ; envoyé QUE
//              dans le mode « Changer l'ordre » (msg.ordre === true), qui vide alors
//              apercu/constats/taches/actions : voir decorerBandeauOrdre()
//
// `boutons` reste un tableau à PLAT — l'hôte ne connaît que lui, jamais deux lignes. Chaque
// bouton porte { …, groupe }, et c'est CETTE page qui le répartit sur ses deux lignes de
// barre (decorerBarre() plus bas) : `groupe: 'filtre'` va sur celle du haut, tout le reste
// (`'action'`, ou l'absence du champ) sur celle du bas. Le split en deux lignes est un
// détail de PRÉSENTATION propre à cette page, pas une clause du protocole.
(function () {
  'use strict';
  var api = acquireVsCodeApi();
  var TXT = __TXT__;
  var poser = SZH.poser;
  var titre = document.getElementById('titre');
  // Deux lignes dans la même barre (media/articles.html, media/articles.css) : les filtres
  // au-dessus, les gestes en dessous — voir decorerBarre() plus bas pour la répartition et
  // le sort de la ligne des filtres en mode « Changer l'ordre ».
  var barreFiltres = document.getElementById('barreFiltres');
  var barreActions = document.getElementById('barreActions');
  var ctlEtat = null;

  var numero = SZH.formulaireNumero({
    conteneur: document.getElementById('numero'),
    api: api,
    txt: TXT,
    etat: document.getElementById('etatNumero'),
    couverture: true
  });
  numero.enregistrement(document.getElementById('enregistrer'));

  var cartes = document.getElementById('cartes');
  var liste = SZH.listeCartes({
    conteneur: cartes,
    textes: function () { return TXT; },
    onOuvrir: function (cle) { api.postMessage({ type: SZH.MSG.OUVRIR, cle: cle }); },
    // « Ouvrir l'article » est en fin de pied et arrive donc par `actions`, comme les
    // autres boutons ; c'est pourtant le même geste que la flèche de l'entête, et il part
    // par le même message. L'hôte n'a qu'un chemin pour ouvrir un article, pas deux.
    onAction: function (cle, id) {
      if (id === 'ouvrir') { api.postMessage({ type: SZH.MSG.OUVRIR, cle: cle }); return; }
      api.postMessage({ type: SZH.MSG.ACTION, cle: cle, id: id });
    },
    onTache: function (cle, id, cochee) {
      api.postMessage({ type: SZH.MSG.TACHE, cle: cle, id: id, cochee: cochee });
    }
  });

  // ---- L'aperçu, posé dans la carte ----
  //
  // Les cartes viennent de SZH.listeCartes, le composant des trois vues d'ensemble. Cette
  // page n'en écrit pas une seconde : elle prend celles qui viennent d'être posées, dans
  // l'ordre où elles l'ont été — le même que celui des lignes — et glisse son bloc juste
  // avant les tâches, donc entre l'en-tête et le pied.
  //
  // Rien n'y est modifiable, à une exception près et elle est explicite : la case « pas de
  // DOI », qui n'est pas une métadonnée de l'article mais une décision sur le numéro.
  function decorer(lignes) {
    var boites = cartes.querySelectorAll('.szh-carte');
    for (var i = 0; i < boites.length && i < lignes.length; i++) {
      var ligne = lignes[i] || {};
      // Le mode « Changer l'ordre » réduit la carte à un bandeau : l'hôte ne lui envoie
      // plus ni aperçu, ni tâches, ni constats (chargeArticles, extension.js) — rien à
      // déplier, rien à ouvrir. C'est un décor entièrement différent, voir
      // decorerBandeauOrdre() plus bas.
      if (ordreActif) { decorerBandeauOrdre(boites[i], ligne); continue; }
      var bloc = construireBloc(ligne);
      if (bloc) {
        var cible = boites[i].querySelector('.szh-taches') || boites[i].querySelector('.ligne-pied');
        if (cible) { boites[i].insertBefore(bloc, cible); } else { boites[i].appendChild(bloc); }
      }
      // Après le bloc, et non avant : la barre de titre porte le bouton qui le replie.
      decorerTete(boites[i], ligne, bloc);
    }
  }

  // La tête de la carte : le nom du dossier n'y est plus répété à côté du titre —
  // « 01 · Construire sa propre rampe » porte déjà le rang, et redire le slug juste après
  // ne faisait que doubler la même information. Le slug reste l'identifiant technique de
  // l'article ; il se lit maintenant en infobulle du titre plutôt que sur sa propre ligne.
  // Les avertissements de la carte ne vivent plus ici : ils sont descendus dans l'encadré
  // « À faire », sous les tâches et groupés par gravité (SZH.listeCartes, media/_commun.js).
  // Un avertissement est de la même nature qu'une tâche — quelque chose qui attend — et il
  // se lisait mal en colonne serrée contre le bord droit de la barre de titre.
  //
  // Ne reste donc qu'un geste, à droite du titre : replier l'aperçu des métadonnées. Le
  // bouton « Ouvrir l'article » a quitté l'entête — le même geste ferme déjà le pied de
  // carte, et le répéter ici doublait un bouton pour rien. Le titre lui-même devient la
  // seconde commande de la bascule : un vrai <button>, jamais un <div> cliquable, pour
  // rester atteignable au clavier et actionnable par Entrée/Espace.
  function decorerTete(carte, ligne, bloc) {
    var tete = carte.querySelector('.szh-tete');
    if (!tete) { return; }
    // L'hôte n'envoie plus `meta` pour cette vue (voir extension.js, chargeArticles) ; le
    // retrait ci-dessous reste une garde, au cas où un ancien message traînerait encore.
    var meta = tete.querySelector('.szh-tete-meta');
    if (meta) { meta.remove(); }
    var nom = tete.querySelector('.szh-tete-nom');
    var cle = String(ligne.cle || '');
    if (bloc && nom) {
      var boutonTitre = document.createElement('button');
      boutonTitre.type = 'button';
      boutonTitre.className = nom.className + ' szh-tete-nom--bascule';
      boutonTitre.textContent = ligne.titre || '';
      boutonTitre.title = cle;
      tete.replaceChild(boutonTitre, nom);
      nom = boutonTitre;
    } else if (nom) {
      nom.title = cle;
    }
    if (bloc) {
      var gestes = poser(tete, 'div', 'carte-gestes');
      gestes.appendChild(basculeApercu(cle, bloc, nom));
    }
  }

  // ---- Le bandeau du mode « Changer l'ordre » ----
  //
  // La carte s'y réduit à un simple bandeau de titre : rien à lire, rien à cocher, rien à
  // ouvrir, seulement à classer — l'hôte ne lui a rien envoyé d'autre (chargeArticles,
  // extension.js). Les deux seuls gestes qui restent, monter et descendre, passent donc
  // tout à gauche du bandeau, avant même le rang et le titre.
  function decorerBandeauOrdre(carte, ligne) {
    var tete = carte.querySelector('.szh-tete');
    if (!tete) { return; }
    var meta = tete.querySelector('.szh-tete-meta');
    if (meta) { meta.remove(); }
    var nom = tete.querySelector('.szh-tete-nom');
    if (nom) {
      // Tronqué sur une seule ligne, ici seulement : le bandeau doit tenir en une ligne
      // quoi qu'il arrive — contrairement à la carte complète, où un titre exceptionnel a
      // le droit de passer à la ligne (media/articles.css, #cartes .szh-tete-nom).
      nom.classList.add('tete-nom-tronque');
      nom.title = ligne.titre || '';
    }
    var o = ligne.ordre || {};
    var cle = String(ligne.cle || '');
    // Construit à part, puis inséré en tête : jamais ajouté d'abord à `tete` pour être
    // ensuite déplacé, ce qui dupliquerait le nœud dans un DOM qui ne sait pas vraiment
    // repositionner (voir le correctif d'insertBefore, test/js/dom-minimal.js).
    var boutons = document.createElement('div');
    boutons.className = 'carte-ordre';
    boutons.appendChild(boutonFlecheOrdre('monter', 'haut', o.monter, cle));
    boutons.appendChild(boutonFlecheOrdre('descendre', 'bas', o.descendre, cle));
    tete.insertBefore(boutons, tete.firstChild);
  }

  // Une flèche seule, sans libellé visible. L'infobulle reprend le tip générique de la
  // carte complète (art.monter.tip / art.descendre.tip, mêmes clés) ; l'aria-label, lui,
  // est SPÉCIFIQUE — il nomme l'article et le rang visé, calculé côté hôte (prefixeOrdre,
  // lib/articles.js) — sans quoi deux flèches « Monter » consécutives se liraient pareil
  // au clavier. Un bouton désactivé porte déjà le générique en repli (chargeArticles) : il
  // n'annonce donc jamais un rang qui n'existe pas.
  function boutonFlecheOrdre(id, icone, info, cle) {
    var o = info || {};
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'szh-ico';
    b.appendChild(SZH.icone(icone));
    b.title = o.tip || '';
    b.setAttribute('aria-label', o.ariaLabel || o.tip || '');
    b.disabled = !!o.desactive;
    b.addEventListener('click', function () {
      api.postMessage({ type: SZH.MSG.ACTION, cle: cle, id: id });
    });
    return b;
  }

  // Les aperçus repliés, par slug. Retenu pour la durée de la page : un re-rendu — un ordre
  // enregistré, une métadonnée de numéro écrite — repose toutes les cartes, et sans cette
  // mémoire il redéplierait ce qu'on vient de replier. La page n'a pas
  // `retainContextWhenHidden` : passer à un autre onglet et revenir remet tout à plat, et
  // c'est assumé — l'état déplié est celui qui montre tout, jamais celui qui cache.
  //
  // Ce ne sont que des exceptions : l'état de départ de toutes les cartes vient de l'hôte
  // (metaRepliees, l'interrupteur « Cacher les métadonnées » de la barre), et un slug
  // absent d'ici le suit. Actionner l'interrupteur efface les exceptions — c'est un geste
  // qui porte sur toutes les cartes, il ne laisse pas trois cartes en travers.
  var replies = Object.create(null);
  var metaRepliees = false;
  // L'état du mode « Changer l'ordre », lu à chaque message « valeurs » (msg.ordre) : il
  // décide, dans decorer() ci-dessus, entre la carte complète et le bandeau minimal.
  var ordreActif = false;

  function estReplie(cle) {
    return (cle in replies) ? replies[cle] === true : metaRepliees;
  }

  // Le bouton « Afficher / cacher les métadonnées » d'une carte, réduit au chevron : plus
  // de texte visible, la carte en porte déjà assez pour rester compacte. Ce qu'il replie
  // est le seul bloc d'aperçu : le titre, les tâches et les constats restent, puisque
  // c'est sur eux qu'on parcourt un numéro. Son libellé dit toujours le geste à venir, pas
  // l'état courant — « Cacher les métadonnées » quand elles sont là — mais ne vit plus que
  // dans l'infobulle et l'aria-label, faute de texte pour le porter ; `aria-expanded` dit
  // l'état. `boutonTitre`, quand il existe, est LE MÊME geste sous une autre forme : les
  // deux se déclenchent l'un l'autre et partagent `aria-expanded`.
  function basculeApercu(cle, bloc, boutonTitre) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'szh-ico bouton-bascule';
    b.appendChild(SZH.icone('chevron'));
    function appliquer() {
      var replie = estReplie(cle);
      var libelle = replie ? (TXT.metaVoir || '') : (TXT.metaCacher || '');
      bloc.hidden = replie;
      b.title = libelle;
      b.setAttribute('aria-label', libelle);
      b.setAttribute('aria-expanded', replie ? 'false' : 'true');
      if (boutonTitre) { boutonTitre.setAttribute('aria-expanded', replie ? 'false' : 'true'); }
    }
    function basculer() { replies[cle] = !estReplie(cle); appliquer(); }
    b.addEventListener('click', basculer);
    if (boutonTitre) { boutonTitre.addEventListener('click', basculer); }
    appliquer();
    return b;
  }

  // -> l'élément à insérer, ou null quand la ligne n'apporte ni aperçu ni case. Les
  // avertissements (ligne.constats) sont posés dans la tête de la carte par decorerTete()
  // ci-dessus : ce bloc ne porte plus que l'aperçu des métadonnées et l'échappatoire.
  function construireBloc(ligne) {
    var apercu = ligne.apercu || null;
    var sansDoi = ligne.sansDoi || null;
    if (!apercu && !sansDoi) { return null; }
    var bloc = document.createElement('div');
    bloc.className = 'carte-apercu';
    if (apercu) { poserGrille(bloc, apercu.lignes || []); }
    if (sansDoi) {
      // Sur la même ligne que le DOI qu'elle concerne : la case rejoint la valeur
      // de la dernière rangée de la grille — la ligne DOI, toujours en fin d'aperçu — au
      // lieu de rester un bloc à part sous la grille entière.
      var valeurs = bloc.querySelectorAll('.apercu-valeur');
      poserCaseDoi(valeurs.length > 0 ? valeurs[valeurs.length - 1] : bloc, ligne);
    }
    return bloc;
  }

  // Une rangée par champ : l'intitulé d'un côté, une valeur par langue de l'autre. Une liste
  // de définitions, et non un tableau : ce sont des couples nom/valeur, et un lecteur
  // d'écran les annonce alors comme tels.
  function poserGrille(bloc, lignes) {
    var dl = poser(bloc, 'dl', 'apercu-grille');
    for (var i = 0; i < lignes.length; i++) {
      var rangee = poser(dl, 'div', 'apercu-rangee');
      poser(rangee, 'dt', 'apercu-cle', lignes[i].libelle || '');
      var dd = poser(rangee, 'dd', 'apercu-val');
      var valeurs = lignes[i].valeurs || [];
      for (var v = 0; v < valeurs.length; v++) { poserValeur(dd, valeurs[v]); }
    }
  }

  function poserValeur(dd, valeur) {
    var ton = valeur.ton ? ' apercu-valeur--' + valeur.ton : '';
    var el = poser(dd, 'div', 'apercu-valeur' + ton);
    // Le badge de langue tient la place d'un intitulé répété : « Titre (français) » trois
    // fois de suite ne se lit pas, « FR » se voit.
    if (valeur.marque) { poser(el, 'span', 'apercu-langue', valeur.marque); }
    poser(el, 'span', 'apercu-texte', valeur.texte || '');
    var marques = valeur.marques || [];
    for (var m = 0; m < marques.length; m++) {
      poser(el, 'span', 'apercu-marque', marques[m]);
    }
  }

  // La case « pas de DOI ». Verrouillée quand c'est la rubrique qui décide : la case montre
  // alors l'état sans laisser croire qu'on peut en changer. `parent` est la valeur de la
  // ligne DOI de l'aperçu — ou, à défaut d'aperçu, le bloc entier.
  function poserCaseDoi(parent, ligne) {
    var etat = ligne.sansDoi || {};
    var l = poser(parent, 'label', 'apercu-doi');
    var case_ = document.createElement('input');
    case_.type = 'checkbox';
    case_.checked = !!etat.coche;
    case_.disabled = !!etat.verrouille;
    case_.dataset.sansdoi = String(ligne.cle || '');
    case_.addEventListener('change', function () {
      api.postMessage({ type: SZH.MSG.SANSDOI, cle: String(ligne.cle || ''), coche: !!case_.checked });
    });
    l.appendChild(case_);
    poser(l, 'span', null, TXT.doiCase || '');
    l.title = TXT.doiCaseTip || '';
    return l;
  }

  // ---- La barre en deux lignes ----
  //
  // `groupe` (posé par l'hôte, extension.js) dit la ligne : 'filtre' pour les quatre
  // interrupteurs, tout le reste (`'action'`, ou l'absence du champ) pour les gestes —
  // jamais un bouton perdu entre deux lignes. En mode « Changer l'ordre », la ligne des
  // filtres disparaît (hidden, donc sans le moindre écart — voir media/articles.css) : les
  // quatre interrupteurs y seraient inertes, la vue n'ayant plus ni tâche, ni aperçu, ni
  // avertissement à montrer sur ses bandeaux réduits à deux flèches, et une ligne de
  // boutons sans effet est un mensonge. L'état de la barre (role="status") ne vit que sur
  // la ligne des gestes : c'est le seul endroit d'où partent les phrases qu'elle affiche
  // (« Terminer » qui renomme, par exemple) — les interrupteurs, eux, ne renvoient jamais
  // rien (actionArticle, extension.js) ; deux zones role="status" à la fois auraient fait
  // annoncer un lecteur d'écran deux fois, ou pas du tout.
  function decorerBarre(boutons) {
    var filtres = [];
    var actions = [];
    for (var i = 0; i < (boutons || []).length; i++) {
      (boutons[i].groupe === 'filtre' ? filtres : actions).push(boutons[i]);
    }
    function onCommande(id) { api.postMessage({ type: SZH.MSG.COMMANDE, id: id }); }
    barreFiltres.hidden = ordreActif;
    if (!ordreActif) { SZH.barreBoutons(barreFiltres, filtres, onCommande, { sansEtat: true }); }
    ctlEtat = SZH.barreBoutons(barreActions, actions, onCommande);
  }

  // ---- Messages ----
  var recu = false;
  window.addEventListener('message', function (ev) {
    var msg = ev.data || {};
    recu = true;
    // Le formulaire du numéro traite « valeurs », « enregistre », « erreur » et
    // « couverture » ; la page continue sur ce que la vue ajoute autour. Un re-rendu ne
    // doit pas jeter une saisie en cours : le formulaire n'est rechargé que s'il n'a rien
    // de non enregistré, comme le panneau de traduction s'en garde.
    var traiteParNumero = false;
    if (msg.type !== SZH.MSG.VALEURS || !numero.estModifie()) { traiteParNumero = numero.message(msg); }
    if (msg.type === SZH.MSG.VALEURS) {
      SZH.poserAccent(msg.accent);
      titre.textContent = msg.titre || '';
      // Avant decorer(), qui pose les blocs et lit cet état. L'interrupteur vient de
      // bouger : les cartes tenues à part retrouvent le rang, sans quoi celle qu'on avait
      // dépliée resterait seule ouverte sur une liste qu'on vient de tout replier.
      var repliDemande = msg.metaRepliees === true;
      if (repliDemande !== metaRepliees) { metaRepliees = repliDemande; replies = Object.create(null); }
      ordreActif = msg.ordre === true;
      // Accroche CSS pour le mode : le bandeau ne doit jamais passer à la ligne
      // (media/articles.css, #cartes.mode-ordre .szh-tete), contrairement à la carte
      // complète, où .szh-tete porte flex-wrap (media/_liste.css).
      cartes.classList.toggle('mode-ordre', ordreActif);
      decorerBarre(msg.boutons || []);
      liste.rendre(msg.lignes || []);
      decorer(msg.lignes || []);
      return;
    }
    // Une case cochée ne renvoie que sa pastille : reconstruire la liste ferait perdre au
    // clavier le focus de la case qu'il vient d'utiliser.
    if (msg.type === SZH.MSG.AVANCEMENT) {
      liste.majPastilles(msg.cle, msg.pastilles || [], msg.tachesResume);
      return;
    }
    if (msg.type === SZH.MSG.ETAT) {
      if (ctlEtat) { ctlEtat.textContent = msg.message || ''; }
      return;
    }
    if (!traiteParNumero) { console.warn('articles : type de message inconnu', msg.type); }
  });
  SZH.annoncerPret(api, function () { return recu; });
})();
