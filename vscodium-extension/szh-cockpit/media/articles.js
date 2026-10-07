// Vue « Articles » : l'ordre du numéro, l'avancement de chaque article et les métadonnées
// du numéro, regardés ensemble quand on monte un numéro.
//
// Les cartes sont posées par SZH.listeCartes et la barre par SZH.barreBoutons (_commun.js),
// comme dans « Traductions » et « Word en attente ». Le formulaire du numéro est
// SZH.formulaireNumero (_numero.js), le même que la page « Métadonnées du numéro ».
//
// Les intitulés des tâches se règlent dans les réglages protégés (« Réglages SZH »,
// lib/reglages-proteges.js) ; le bouton de la barre y renvoie. Cette page porte les cases à
// cocher, propres à chaque article.
//
// L'aperçu des métadonnées est en lecture seule ; les deux boutons du pied mènent aux
// formulaires qui écrivent. Il est inséré dans la carte de SZH.listeCartes.
//
// Variante livre (TXT.estLivre, posé par l'hôte quand le dossier porte un buch.yaml) : la
// page montre les chapitres, avec SZH.formulaireLivre (_numero.js) en tête. L'hôte n'envoie
// alors ni DOI, ni case « pas de DOI », ni tâches.
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
//   ordre    = { monter, descendre } ({ desactive, tip, ariaLabel } chacun), envoyé
//              seulement en mode « Changer l'ordre » (msg.ordre === true), qui vide alors
//              apercu/constats/taches/actions : voir decorerBandeauOrdre()
//
// `boutons` est un tableau à plat. Chaque bouton porte { …, groupe }, et cette page le
// répartit sur ses deux lignes de barre (decorerBarre()) : `groupe: 'filtre'` en haut, le
// reste (`'action'` ou champ absent) en bas. Les deux lignes sont un choix de présentation
// de la page, pas une clause du protocole.
(function () {
  'use strict';
  var api = acquireVsCodeApi();
  var TXT = __TXT__;
  var poser = SZH.poser;
  var titre = document.getElementById('titre');
  // Deux lignes dans la même barre (articles.html, articles.css) : les filtres au-dessus,
  // les actions en dessous ; voir decorerBarre().
  var barreFiltres = document.getElementById('barreFiltres');
  var barreActions = document.getElementById('barreActions');
  var ctlEtat = null;

  var estLivre = TXT.estLivre === true;
  var numero = (estLivre ? SZH.formulaireLivre : SZH.formulaireNumero)({
    conteneur: document.getElementById('numero'),
    api: api,
    txt: TXT,
    etat: document.getElementById('etatNumero'),
    couverture: !estLivre
  });
  numero.enregistrement(document.getElementById('enregistrer'));

  var cartes = document.getElementById('cartes');
  var liste = SZH.listeCartes({
    conteneur: cartes,
    textes: function () { return TXT; },
    onOuvrir: function (cle) { api.postMessage({ type: SZH.MSG.OUVRIR, cle: cle }); },
    // « Ouvrir l'article », en fin de pied, arrive par `actions` comme les autres boutons,
    // mais part par le même message que la flèche de l'entête : l'hôte n'a qu'un chemin
    // pour ouvrir un article.
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
  // Les cartes viennent de SZH.listeCartes. La page les reprend dans l'ordre où elles ont
  // été posées (celui des lignes) et insère son bloc avant les tâches, entre l'en-tête et le
  // pied.
  //
  // Rien n'y est modifiable, sauf la case « pas de DOI », qui est une décision sur le
  // numéro et non une métadonnée de l'article.
  function decorer(lignes) {
    var boites = cartes.querySelectorAll('.szh-carte');
    for (var i = 0; i < boites.length && i < lignes.length; i++) {
      var ligne = lignes[i] || {};
      // Le mode « Changer l'ordre » réduit la carte à un bandeau : l'hôte n'envoie ni
      // aperçu, ni tâches, ni constats (chargeArticles, extension.js). Voir
      // decorerBandeauOrdre().
      if (ordreActif) { decorerBandeauOrdre(boites[i], ligne); continue; }
      var bloc = construireBloc(ligne);
      if (bloc) {
        var cible = boites[i].querySelector('.szh-taches') || boites[i].querySelector('.ligne-pied');
        if (cible) { boites[i].insertBefore(bloc, cible); } else { boites[i].appendChild(bloc); }
      }
      // Après le bloc : la barre de titre porte le bouton qui le replie.
      decorerTete(boites[i], ligne, bloc);
    }
  }

  // La tête de la carte. Le titre (« 01 · Construire sa propre rampe ») porte déjà le rang ;
  // le slug se lit en infobulle. Les avertissements sont dans l'encadré « À faire »
  // (SZH.listeCartes). À droite du titre, un seul bouton : replier l'aperçu des
  // métadonnées. Le titre lui-même sert aussi de bascule : un vrai <button>, atteignable au
  // clavier et actionnable par Entrée ou Espace.
  function decorerTete(carte, ligne, bloc) {
    var tete = carte.querySelector('.szh-tete');
    if (!tete) { return; }
    // L'hôte n'envoie pas `meta` pour cette vue (chargeArticles, extension.js) ; le retrait
    // ci-dessous est une précaution.
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
  // La carte se réduit à un bandeau de titre : seulement à classer, l'hôte n'envoie rien
  // d'autre (chargeArticles, extension.js). Les flèches monter et descendre se placent à
  // gauche du bandeau, avant le rang et le titre.
  function decorerBandeauOrdre(carte, ligne) {
    var tete = carte.querySelector('.szh-tete');
    if (!tete) { return; }
    var meta = tete.querySelector('.szh-tete-meta');
    if (meta) { meta.remove(); }
    var nom = tete.querySelector('.szh-tete-nom');
    if (nom) {
      // Tronqué sur une ligne dans ce mode seulement ; dans la carte complète, le titre
      // passe à la ligne (articles.css, #cartes .szh-tete-nom).
      nom.classList.add('tete-nom-tronque');
      nom.title = ligne.titre || '';
    }
    var o = ligne.ordre || {};
    var cle = String(ligne.cle || '');
    // Construit à part puis inséré en tête, sans passer d'abord par `tete` : un déplacement
    // dupliquerait le nœud dans le DOM des tests (voir insertBefore dans
    // test/js/dom-minimal.js).
    var boutons = document.createElement('div');
    boutons.className = 'carte-ordre';
    boutons.appendChild(boutonFlecheOrdre('monter', 'haut', o.monter, cle));
    boutons.appendChild(boutonFlecheOrdre('descendre', 'bas', o.descendre, cle));
    tete.insertBefore(boutons, tete.firstChild);
  }

  // Une flèche seule, sans libellé visible. L'infobulle reprend le tip générique de la
  // carte complète (art.monter.tip / art.descendre.tip) ; l'aria-label nomme l'article et le
  // rang visé, calculé par l'hôte (prefixeOrdre, lib/articles.js), pour que deux flèches
  // « Monter » consécutives se distinguent au clavier. Un bouton désactivé porte le
  // libellé générique (chargeArticles) : il n'annonce pas de rang inexistant.
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

  // Les aperçus repliés, par slug, gardés pour la durée de la page : un nouveau rendu (un
  // ordre enregistré, une métadonnée de numéro écrite) repose toutes les cartes et
  // redéplierait ce qu'on vient de replier. Sans `retainContextWhenHidden`, changer
  // d'onglet et revenir remet tout à l'état de départ.
  //
  // Ce sont des exceptions : l'état de départ de toutes les cartes vient de l'hôte
  // (metaRepliees, l'interrupteur « Cacher les métadonnées » de la barre). Actionner
  // l'interrupteur efface les exceptions.
  var replies = Object.create(null);
  var metaRepliees = false;
  // L'état du mode « Changer l'ordre », lu à chaque message « valeurs » (msg.ordre) : il
  // choisit, dans decorer(), entre la carte complète et le bandeau.
  var ordreActif = false;

  function estReplie(cle) {
    return (cle in replies) ? replies[cle] === true : metaRepliees;
  }

  // Le bouton « Afficher / cacher les métadonnées » d'une carte, réduit au chevron. Il ne
  // replie que le bloc d'aperçu : le titre, les tâches et les constats restent. Son libellé,
  // dans l'infobulle et l'aria-label, dit l'action à venir ; `aria-expanded` dit l'état.
  // `boutonTitre`, s'il existe, fait la même chose : les deux se déclenchent l'un l'autre et
  // partagent `aria-expanded`.
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

  // -> l'élément à insérer, ou null quand la ligne n'apporte ni aperçu ni case. Le bloc
  // porte l'aperçu des métadonnées et la case « pas de DOI » ; les avertissements
  // (ligne.constats) sont posés par SZH.listeCartes.
  function construireBloc(ligne) {
    var apercu = ligne.apercu || null;
    var sansDoi = ligne.sansDoi || null;
    if (!apercu && !sansDoi) { return null; }
    var bloc = document.createElement('div');
    bloc.className = 'carte-apercu';
    if (apercu) { poserGrille(bloc, apercu.lignes || []); }
    if (sansDoi) {
      // Sur la ligne du DOI qu'elle concerne : la case rejoint la valeur de la dernière
      // rangée de la grille, toujours celle du DOI.
      var valeurs = bloc.querySelectorAll('.apercu-valeur');
      poserCaseDoi(valeurs.length > 0 ? valeurs[valeurs.length - 1] : bloc, ligne);
    }
    return bloc;
  }

  // Une rangée par champ : l'intitulé d'un côté, une valeur par langue de l'autre. Une liste
  // de définitions plutôt qu'un tableau, pour qu'un lecteur d'écran annonce des couples
  // nom/valeur.
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
    // Le badge de langue remplace un intitulé répété (« FR » plutôt que « Titre
    // (français) » trois fois).
    if (valeur.marque) { poser(el, 'span', 'apercu-langue', valeur.marque); }
    poser(el, 'span', 'apercu-texte', valeur.texte || '');
    var marques = valeur.marques || [];
    for (var m = 0; m < marques.length; m++) {
      poser(el, 'span', 'apercu-marque', marques[m]);
    }
  }

  // La case « pas de DOI ». Verrouillée quand la rubrique décide : elle montre l'état sans
  // permettre de le changer. `parent` est la valeur de la ligne DOI de l'aperçu, ou à défaut
  // le bloc entier.
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
  // `groupe` (posé par l'hôte, extension.js) choisit la ligne : 'filtre' pour les quatre
  // interrupteurs, le reste (`'action'` ou champ absent) pour les actions. En mode « Changer
  // l'ordre », la ligne des filtres est cachée (hidden, sans écart, voir articles.css) : ses
  // interrupteurs n'auraient pas d'effet sur les bandeaux réduits. L'état de la barre
  // (role="status") est sur la ligne des actions seulement, d'où partent les phrases qu'elle
  // affiche (actionArticle, extension.js) : deux zones role="status" feraient annoncer un
  // lecteur d'écran deux fois, ou pas du tout.
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
    // « couverture » ; la page traite le reste. Pour ne pas perdre une saisie en cours, le
    // formulaire n'est rechargé que s'il n'a rien de non enregistré.
    var traiteParNumero = false;
    if (msg.type !== SZH.MSG.VALEURS || !numero.estModifie()) { traiteParNumero = numero.message(msg); }
    if (msg.type === SZH.MSG.VALEURS) {
      SZH.poserAccent(msg.accent);
      titre.textContent = msg.titre || '';
      // Avant decorer(), qui lit cet état. Quand l'interrupteur vient de changer, les
      // exceptions sont effacées, sans quoi une carte dépliée resterait seule ouverte.
      var repliDemande = msg.metaRepliees === true;
      if (repliDemande !== metaRepliees) { metaRepliees = repliDemande; replies = Object.create(null); }
      ordreActif = msg.ordre === true;
      // Classe CSS du mode : le bandeau ne passe pas à la ligne (articles.css,
      // #cartes.mode-ordre .szh-tete), alors que .szh-tete porte flex-wrap (_liste.css).
      cartes.classList.toggle('mode-ordre', ordreActif);
      decorerBarre(msg.boutons || []);
      liste.rendre(msg.lignes || []);
      decorer(msg.lignes || []);
      return;
    }
    // Une case cochée ne renvoie que sa pastille : reconstruire la liste ferait perdre le
    // focus clavier de la case.
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
